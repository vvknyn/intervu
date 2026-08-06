/**
 * Cellular transport. The laptop offers, the phone answers, and after the
 * introduction the two talk directly — so the user's screen never touches
 * intervu.cc. That is a property of the wiring, not a promise we make.
 *
 * Frames ride a data channel rather than a video track because CDP already
 * hands us finished JPEGs; putting them through an H.264 encoder would mean
 * decoding and re-encoding for no gain.
 *
 * No trickle ICE. Verified on werift 0.24.3: `await setLocalDescription()`
 * leaves `iceGatheringState` at "complete" and the SDP already carries a
 * `typ srflx` candidate, so one SDP each way is the whole handshake.
 */

import { RTCPeerConnection } from "werift";

const STUN = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

export function signalUrl(apiBase, id) {
    return `${apiBase.replace(/\/$/, "")}/api/viewer/session/${id}/signal`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Waits for the phone to open the link, until the session itself expires.
 *
 * Bounded by the server's own `expiresAt` rather than an attempt count
 * chosen separately: a fixed count is a second, silently disagreeing copy of
 * the session lifetime, and the first version gave up after two minutes on a
 * session that lived fifteen — so anyone slower than that to pick up their
 * phone got a link that could never connect.
 *
 * A transient non-200 counts as "not yet", not as failure: one 503 from a
 * redeploy should not end a session that would otherwise have worked.
 * Passing the deadline throws, because a silent hang is the one outcome with
 * no diagnosis.
 *
 * Polling backs off. A phone that answers does so in the first seconds
 * (the user just tapped the link), so early polls are dense; one that has
 * not answered in a minute is in a pocket, and asking our server every two
 * seconds for fourteen more minutes is ~450 requests to learn "no". The
 * ramp keeps the fast case fast and cuts the slow case to ~60 requests.
 *
 * @param {typeof fetch} fetchImpl
 * @param {string} url
 * @param {{deadline: number, delayMs?: number, maxDelayMs?: number,
 *          headers?: Record<string,string>, sleepImpl?: (ms:number)=>Promise<void>}} options
 *        `deadline` is the session's own expiresAt, in epoch ms.
 * @returns {Promise<{sdp: string}>}
 */
export async function pollUntilGuest(fetchImpl, url, { deadline, delayMs = 1000, maxDelayMs = 15000, headers = {}, sleepImpl = sleep } = {}) {
    // Without this a missing deadline makes the comparison below false and
    // the function gives up instantly, which reads exactly like a phone that
    // never connected.
    if (!Number.isFinite(deadline)) throw new Error("pollUntilGuest needs the session's expiresAt as `deadline`");
    let delay = delayMs;
    while (Date.now() < deadline) {
        const res = await fetchImpl(url, { headers });
        if (res.ok) {
            const body = await res.json();
            if (body.guest) return body.guest;
        }
        await sleepImpl(delay);
        delay = nextPollDelay(delay, maxDelayMs);
    }
    throw new Error("The phone never connected before the watch link expired — it may not have been opened.");
}

/** Doubles toward the cap. Pure so the ramp is testable without clocks;
 *  a zero delay stays zero, which is what lets tests run instantly. */
export function nextPollDelay(delayMs, maxDelayMs) {
    return Math.min(delayMs * 2, maxDelayMs);
}

export function createWebRtcTransport({ apiBase, bearer, fetchImpl = fetch }) {
    const base = apiBase.replace(/\/$/, "");
    const auth = { authorization: `Bearer ${bearer}`, "content-type": "application/json" };
    let pc = null;
    let channel = null;
    let sessionId = null;

    return {
        /**
         * Returns as soon as there is a link worth sending, and reports the
         * rest separately: waiting for the phone to answer takes as long as
         * the user takes to pick it up, and the URL cannot be delivered until
         * this returns. Awaiting the whole handshake here would mean the link
         * only appears once the phone had already used it.
         *
         * @returns {Promise<{ url: string, connected: Promise<void> }>}
         *   `connected` settles when the phone answers, or rejects with why
         *   it never did. Frames sent before then are dropped by sendFrame.
         */
        async start() {
            const created = await fetchImpl(`${base}/api/viewer/session`, { method: "POST", headers: auth });
            if (!created.ok) {
                throw new Error(`could not open a viewer session (HTTP ${created.status}) — the agent's intervu login may have expired; 'mcporter auth intervu-cc-mcp' renews it`);
            }
            const { sessionId: id, expiresAt } = await created.json();
            sessionId = id;
            // Composed here rather than returned by the server: this side
            // chose the origin, so this side is the only one that can be
            // sure the phone can reach it.
            const watchUrl = `${base}/watch/${sessionId}`;

            pc = new RTCPeerConnection(STUN);
            channel = pc.createDataChannel("frames");
            await pc.setLocalDescription(await pc.createOffer());

            const url = signalUrl(base, sessionId);
            await fetchImpl(url, {
                method: "POST",
                headers: auth,
                body: JSON.stringify({ role: "host", sdp: pc.localDescription.sdp }),
            });

            const connected = pollUntilGuest(fetchImpl, url, { headers: auth, deadline: expiresAt })
                .then((guest) => pc.setRemoteDescription({ type: "answer", sdp: guest.sdp }));

            return { url: watchUrl, connected };
        },

        sendFrame(payload) {
            if (channel?.readyState === "open") channel.send(payload);
        },

        async close() {
            try {
                channel?.close();
                pc?.close();
            } catch {
                // Already torn down; the session delete below still matters.
            }
            if (sessionId) {
                // The spec requires the session to die at handoff rather than
                // linger to its TTL, so this is the boundary closing.
                await fetchImpl(signalUrl(base, sessionId), { method: "DELETE", headers: auth }).catch(() => {});
            }
        },
    };
}

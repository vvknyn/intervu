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
 * Waits for the phone to open the link. A transient non-200 is treated as
 * "not yet" rather than a failure: the user may take a minute to pick the
 * phone up, and one 503 from a redeploy should not end a session that would
 * otherwise have worked. Running out of attempts throws, because a silent
 * hang is the one outcome with no diagnosis.
 */
export async function pollUntilGuest(fetchImpl, url, { attempts = 60, delayMs = 2000, headers = {} } = {}) {
    for (let i = 0; i < attempts; i++) {
        const res = await fetchImpl(url, { headers });
        if (res.ok) {
            const body = await res.json();
            if (body.guest) return body.guest;
        }
        await sleep(delayMs);
    }
    throw new Error("The phone never connected — the watch link may not have been opened.");
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
            const { sessionId: id, watchUrl } = await created.json();
            sessionId = id;

            pc = new RTCPeerConnection(STUN);
            channel = pc.createDataChannel("frames");
            await pc.setLocalDescription(await pc.createOffer());

            const url = signalUrl(base, sessionId);
            await fetchImpl(url, {
                method: "POST",
                headers: auth,
                body: JSON.stringify({ role: "host", sdp: pc.localDescription.sdp }),
            });

            const connected = pollUntilGuest(fetchImpl, url, { headers: auth })
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

/**
 * Cellular transport. The laptop offers, the phone answers, and after the
 * introduction the two talk directly — so the user's screen never touches
 * intervu's servers. That is a property of the wiring, not a promise we make.
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
import { fingerprintSdp } from "./sdp-fingerprint.mjs";

const STUN = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

/**
 * A frame does not fit in one data-channel message. Seen live 2026-08-05:
 * the first real frame (142,255 bytes) hit the channel's negotiated
 * max-message-size of 65,536 — a ceiling the REMOTE side advertises, so no
 * local configuration can lift it — and the throw from inside onopen took
 * the whole viewer down. 15,000 bytes stays under the 16 KiB size browsers
 * reliably interoperate at.
 *
 * Framing: ordered channel, so each piece is "C" + body (continue) or
 * "F" + body (final); the receiver concatenates until "F". Pure and
 * exported so the exact splitting is testable without a peer.
 */
export const CHUNK_BYTES = 15000;

export function* chunkPayload(payload, chunkBytes = CHUNK_BYTES) {
    for (let i = 0; i < payload.length; i += chunkBytes) {
        const last = i + chunkBytes >= payload.length;
        yield (last ? "F" : "C") + payload.slice(i, i + chunkBytes);
    }
}

export function signalUrl(apiBase, id) {
    return `${apiBase.replace(/\/$/, "")}/api/viewer/session/${id}/signal`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Whether a guest answer sitting on the doorbell is worth accepting, versus
 * a stale entry left over from before this renegotiation (D11).
 *
 * The guest stamps a fingerprint of the offer it actually answered
 * (`answeredOffer`) — comparing THAT against the offer this poll is waiting
 * on is the only check that survives a reload: a phone that reloads
 * mid-renegotiation and re-answers the SAME stale offer produces a
 * BYTE-DIFFERENT answer SDP every time (fresh ICE credentials on every
 * `createAnswer()` call), so comparing the answer's own bytes against the
 * previous answer (`ignoreSdp`) cannot catch it — it looks "new" every
 * time, and `setRemoteDescription` gets poisoned with an answer to an offer
 * this pc never sent. `ignoreSdp` stays as the fallback for a guest blob
 * with no `answeredOffer` (an older page, or a doorbell fake with no
 * fingerprint) so this degrades to the previous behaviour rather than
 * breaking, but a fingerprint is trusted over it whenever one is present.
 *
 * @param {{sdp: string, answeredOffer?: string}} guest
 * @param {{ignoreSdp?: string|null, offerFingerprint?: string|null}} [options]
 */
export function isFreshAnswer(guest, { ignoreSdp = null, offerFingerprint = null } = {}) {
    if (guest.answeredOffer != null && offerFingerprint != null) {
        return guest.answeredOffer === offerFingerprint;
    }
    return guest.sdp !== ignoreSdp;
}

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
 *          headers?: Record<string,string>, sleepImpl?: (ms:number)=>Promise<void>,
 *          ignoreSdp?: string|null, offerFingerprint?: string|null}} options
 *        `deadline` is the session's own expiresAt, in epoch ms. `ignoreSdp`
 *        / `offerFingerprint` (D11) are handed to `isFreshAnswer` — see its
 *        doc for why the fingerprint is trusted first.
 * @returns {Promise<{sdp: string}>}
 */
export async function pollUntilGuest(fetchImpl, url, { deadline, delayMs = 1000, maxDelayMs = 15000, headers = {}, sleepImpl = sleep, ignoreSdp = null, offerFingerprint = null } = {}) {
    // Without this a missing deadline makes the comparison below false and
    // the function gives up instantly, which reads exactly like a phone that
    // never connected.
    if (!Number.isFinite(deadline)) throw new Error("pollUntilGuest needs the session's expiresAt as `deadline`");
    let delay = delayMs;
    while (Date.now() < deadline) {
        // A thrown fetch is the same "not yet" as a 503 — a WiFi hiccup on
        // the laptop must not abandon a session the phone may still open.
        // Seen live 2026-08-05: one blip ended a 15-minute wait with
        // "fetch failed" while the session sat valid on the doorbell.
        let res = null;
        try {
            res = await fetchImpl(url, { headers });
        } catch {
            /* the deadline bounds how long we keep hoping */
        }
        if (res?.ok) {
            const body = await res.json();
            if (body.guest && isFreshAnswer(body.guest, { ignoreSdp, offerFingerprint })) return body.guest;
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

/** Connection states that mean this peer connection is done for and, while
 *  the session is still live, worth replacing rather than leaving stranded. */
const DEAD_STATES = new Set(["failed", "closed", "disconnected"]);

/**
 * @param {object} deps
 * @param {string} deps.apiBase
 * @param {string} deps.bearer
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {(text: string, source: "webrtc") => void} deps.onInput
 * @param {() => void} [deps.onDisconnect]  called when the data channel
 *  closes, so the caller can re-arm its input-sink gate before (or
 *  independent of) any reconnect this triggers.
 */
export function createWebRtcTransport({ apiBase, bearer, fetchImpl = fetch, onInput, onDisconnect = undefined }) {
    const base = apiBase.replace(/\/$/, "");
    const auth = { authorization: `Bearer ${bearer}`, "content-type": "application/json" };
    let pc = null;
    let channel = null;
    let sessionId = null;
    let expiresAt = null;
    // The answer this pc last accepted — passed back into pollUntilGuest as
    // ignoreSdp on reconnect so a beat where the doorbell still holds the
    // OLD answer cannot be mistaken for the guest having already re-answered.
    let lastAnswerSdp = null;
    let reconnecting = false;
    // Chrome emits a frame only when pixels change, and the phone usually
    // connects AFTER the last change — a form sitting still. Without replay
    // the channel opens onto nothing and the viewer looks broken. Same rule
    // as the LAN transport's late-joiner replay; each transport owes a new
    // subscriber the current screen.
    let lastPayload = null;

    // A failed send must never take the viewer down — the LAN link would die
    // with it for nothing. Skipping one frame is invisible; the next change
    // (or the replay) repaints.
    const deliver = (targetChannel, payload) => {
        try {
            for (const piece of chunkPayload(payload)) targetChannel.send(piece);
        } catch (error) {
            console.error(`Dropped a frame to the phone (${error.message}).`);
        }
    };

    // Frames only ever flow laptop→phone, so in principle this channel
    // never receives one — but parsing by prefix rather than direction means
    // a stray chunk is silently ignored instead of corrupting onInput.
    const handleChannelMessage = (data) => {
        if (data[0] === "C" || data[0] === "F") return;
        onInput?.(data, "webrtc");
    };

    /**
     * The offer/POST/poll/answer sequence, reusable for both the initial
     * connection and every reconnect (D11). Resolves once the new pc is
     * live; `onOffered` — invoked right after the offer is posted — is how
     * `start()` still returns as soon as there is a link worth sending
     * without waiting for a phone that may take a minute to be picked up.
     *
     * Everything from the offer onward runs inside a try/catch that closes
     * `newPc` on any failure (a rejected POST, a poll that times out, a
     * bad answer) — otherwise a failed attempt leaks the werift peer
     * connection (and the OS socket it opened for ICE) with nothing left
     * holding a reference to close it.
     */
    async function negotiate(previousAnswerSdp, { onOffered } = {}) {
        const newPc = new RTCPeerConnection(STUN);
        const newChannel = newPc.createDataChannel("frames");
        newChannel.onopen = () => {
            if (lastPayload) deliver(newChannel, lastPayload);
        };
        newChannel.onmessage = (event) => handleChannelMessage(String(event.data));
        try {
            await newPc.setLocalDescription(await newPc.createOffer());
            const offerFingerprint = fingerprintSdp(newPc.localDescription.sdp);

            const url = signalUrl(base, sessionId);
            await fetchImpl(url, {
                method: "POST",
                headers: auth,
                body: JSON.stringify({ role: "host", sdp: newPc.localDescription.sdp }),
            });
            onOffered?.();

            const guest = await pollUntilGuest(fetchImpl, url, { headers: auth, deadline: expiresAt, ignoreSdp: previousAnswerSdp, offerFingerprint });
            await newPc.setRemoteDescription({ type: "answer", sdp: guest.sdp });

            pc = newPc;
            channel = newChannel;
            lastAnswerSdp = guest.sdp;
            wireLifecycle(newPc, newChannel);
        } catch (error) {
            newPc.close();
            throw error;
        }
    }

    /** Detects the two ways a peer connection dies and, while the session
     *  hasn't expired, replaces it instead of leaving the phone stranded. */
    function wireLifecycle(livePc, liveChannel) {
        liveChannel.onclose = () => {
            // Re-arms the input gate the same way a LAN client disconnect
            // does: control granted to the peer that just dropped must not
            // silently carry over to whoever (re)connects next.
            onDisconnect?.();
            reconnect();
        };
        livePc.onconnectionstatechange = () => {
            if (DEAD_STATES.has(livePc.connectionState)) reconnect();
        };
    }

    async function reconnect() {
        if (reconnecting || !sessionId || Date.now() >= expiresAt) return;
        reconnecting = true;
        const dead = pc;
        const deadChannel = channel;
        try {
            if (dead) {
                dead.onconnectionstatechange = null; // closing it below must not re-trigger this
                dead.close();
            }
            // Same reasoning as the pc above: without detaching this, the
            // dead channel's own 'close' event (which can still fire after
            // dead.close() completes) would call reconnect() a second time
            // once this attempt has already finished — tearing down the
            // fresh, healthy connection it just negotiated.
            if (deadChannel) deadChannel.onclose = null;
            await negotiate(lastAnswerSdp);
        } catch (error) {
            console.error(`Reconnect failed (${error.message}). The phone can reopen the watch link to try again.`);
        } finally {
            reconnecting = false;
        }
    }

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
            const { sessionId: id, expiresAt: expiry } = await created.json();
            sessionId = id;
            expiresAt = expiry;
            // Composed here rather than returned by the server: this side
            // chose the origin, so this side is the only one that can be
            // sure the phone can reach it.
            const watchUrl = `${base}/watch/${sessionId}`;

            let resolveOffered;
            const offered = new Promise((resolve) => { resolveOffered = resolve; });
            const connected = negotiate(null, { onOffered: resolveOffered });
            await offered;

            return { url: watchUrl, connected };
        },

        sendFrame(payload) {
            lastPayload = payload;
            if (channel?.readyState === "open") deliver(channel, payload);
        },

        async close() {
            // An intentional close must not be read as the disconnect
            // reconnect() exists to recover from — detach before closing,
            // same as reconnect() does to the pc it is replacing.
            if (pc) pc.onconnectionstatechange = null;
            if (channel) channel.onclose = null;
            const closingSessionId = sessionId;
            sessionId = null;
            try {
                channel?.close();
                pc?.close();
            } catch {
                // Already torn down; the session delete below still matters.
            }
            if (closingSessionId) {
                // The spec requires the session to die at handoff rather than
                // linger to its TTL, so this is the boundary closing.
                await fetchImpl(signalUrl(base, closingSessionId), { method: "DELETE", headers: auth }).catch(() => {});
            }
        },
    };
}

/**
 * Pure decisions for the watch canvas's tap+type control (spec D8/D11).
 *
 * Split out of watch-canvas.tsx because this repo has no component-render
 * test harness (no @testing-library / jsdom / vitest dependency — see
 * tests/unit/jobs-upload-continuation.test.ts) but a plain exported function
 * imports and runs fine under `node:test` via tsx. Anything here must stay
 * free of DOM types, RTCPeerConnection, and the openclaw-owned
 * input-capture.mjs (still being written on a parallel track as of this
 * writing) so these tests never depend on either.
 */

/** Shown when the signal fetch comes back !res.ok (session gone or expired). */
export const ENDED_COPY = "This session has ended. The newest message in your chat has the current link.";

export type TapMessage = { v: 1; type: "tap"; fx: number; fy: number; fw: number; fh: number };
export type TapAction = { kind: "zoom" } | { kind: "send"; message: TapMessage };

/**
 * `message` is whatever `frameTapMessage` already produced for this tap (or
 * null when it landed outside the frame, or the caller didn't bother
 * computing one because control is off). With control off the canvas is
 * still just the zoom toggle it always was; with control on, a tap that
 * missed the frame is neither a zoom nor a send — it does nothing, rather
 * than silently zooming while the user thinks they are controlling the page.
 */
export function tapAction(controlOn: boolean, message: TapMessage | null): TapAction | null {
    if (!controlOn) return { kind: "zoom" };
    return message ? { kind: "send", message } : null;
}

/**
 * Guest-side half of D11 reconnect: re-answer only once the laptop has
 * posted a genuinely NEW offer. Reusing the same predicate for the initial
 * join (`previousSdp` is null, so any offer counts as new) and for
 * reconnect (only an offer that differs from the one already answered
 * counts) means there is exactly one rule for "should I answer this offer,"
 * not one ladder per call site.
 */
export function isNewOffer(hostSdp: string | null | undefined, previousSdp: string | null): boolean {
    return Boolean(hostSdp) && hostSdp !== previousSdp;
}

/**
 * The one place any control-channel message leaves this component.
 *
 * `RTCDataChannel.send()` throws synchronously when the channel isn't in
 * the "open" state — a stale channel from a superseded pc mid-reconnect, or
 * one that dropped between renders — and every send site in
 * watch-canvas.tsx (toggleControl, the canvas tap, the typer's input and
 * keydown handlers) shared that exact failure mode. DOM-free (a
 * channel-shaped object, not a real RTCDataChannel) so this is testable
 * without a browser, same reasoning as tapAction/isNewOffer above.
 */
export function trySend(channel: { send: (data: string) => void } | null | undefined, payload: unknown): boolean {
    if (!channel) return false;
    try {
        channel.send(JSON.stringify(payload));
        return true;
    } catch {
        return false;
    }
}

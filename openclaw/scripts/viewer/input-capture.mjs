/**
 * Turns phone gestures on the watch canvas into wire messages: a tap into a
 * frame-pixel point, a vertical swipe into a scroll delta, and the hidden
 * typing field's `input` events into text/Backspace key messages.
 *
 * Pure and served the same way as crop.mjs so the WebRTC page and the LAN
 * page share one set of rules — the two UIs must not drift apart on
 * arithmetic or on typing quirks. The phone reports frame pixels (or frame
 * deltas) plus the frame's own dimensions; only the laptop knows the live
 * device width, so the final frame→device scaling happens there
 * (input-sink.mjs).
 */

/** The CSS-px→frame-px scale a tap or scroll delta is measured against: the
 *  active crop's width over the canvas's on-screen width, or the whole
 *  frame when nothing is cropped. One home for this so a tap and a scroll
 *  from the same touch always agree on scale. */
function frameScale({ cssWidth, crop, imageWidth, imageHeight }) {
    const view = crop ?? { sx: 0, sy: 0, sw: imageWidth, sh: imageHeight };
    return { view, scale: view.sw / cssWidth };
}

export function frameTapMessage({ cssX, cssY, cssWidth, crop, imageWidth, imageHeight }) {
    const { view, scale } = frameScale({ cssWidth, crop, imageWidth, imageHeight });
    const fx = Math.round(view.sx + cssX * scale);
    const fy = Math.round(view.sy + cssY * scale);
    if (fx < 0 || fy < 0 || fx > imageWidth || fy > imageHeight) return null;
    return { v: 1, type: "tap", fx, fy, fw: imageWidth, fh: imageHeight };
}

/**
 * A vertical swipe's accumulated CSS-px delta, in frame pixels — scaled by
 * the exact same rule as a tap (frameScale) so the sink's `fdy * dw / fw`
 * matches a tap's `fx * dw / fw` instead of needing a second scaling rule.
 * No position is carried: a swipe scrolls wherever it happens on the
 * canvas, unlike a tap which targets a specific point.
 */
export function frameScrollMessage({ cssDy, cssWidth, crop, imageWidth, imageHeight }) {
    const { scale } = frameScale({ cssWidth, crop, imageWidth, imageHeight });
    return { v: 1, type: "scroll", fdy: Math.round(cssDy * scale), fw: imageWidth };
}

/** Movement in CSS px beyond which a touch on the canvas is a swipe, not a
 *  tap. Shared so both watch UIs draw the line in the same place — a real
 *  tap must still register as a tap. */
export const SWIPE_THRESHOLD_CSS = 10;
export const isSwipe = (dxCss, dyCss) => Math.hypot(dxCss, dyCss) > SWIPE_THRESHOLD_CSS;

/** Minimum time between scroll sends, in ms. touchmove fires far faster
 *  than the sink needs updates, so deltas accumulate between sends instead
 *  of shipping one message per touchmove event. */
export const SCROLL_THROTTLE_MS = 50;

export const textMessage = (insert) => ({ v: 1, type: "text", insert });
export const keyMessage = (key) => ({ v: 1, type: "key", key });
export const controlMessage = (on) => ({ v: 1, type: "control", on });

/** Zero-width space kept in the hidden typing field at rest. Real-hardware
 *  repro: iOS fires no `input` event at all for backspace on a field that
 *  is already empty, so a deletion past the first character vanished
 *  silently. Both watch UIs must set the field to this on mount AND reset
 *  it to this — never "" — after every classified event. Never sent over
 *  the wire: classifyTyperInput strips it before building a text message. */
export const TYPER_SENTINEL = "\u200b";

/**
 * Classifies one `input` event on the hidden typing field into the wire
 * message(s) to send and the value the caller should reset the field to.
 *
 * The field always reads back as TYPER_SENTINEL plus whatever was typed
 * since the last event (or shorter, when a backward delete ate into the
 * sentinel), because the caller resets to TYPER_SENTINEL — never "" — after
 * every event. Any `*Backward` inputType (deleteContentBackward,
 * deleteWordBackward, deleteSoftLineBackward, ...) sends one Backspace key
 * message per character actually removed — the diff against
 * TYPER_SENTINEL's length, floored at 1 since the browser already told us a
 * deletion happened — because CDP has no single "delete word" key event to
 * dispatch on the remote side. Every other inputType is an insert:
 * TYPER_SENTINEL is stripped off the front of `value` and whatever remains
 * is the text typed since the last event.
 *
 * Shared by both watch UIs — same reason crop.mjs is shared — so a phone
 * typing quirk fixed once here cannot silently drift back on the page that
 * didn't get the fix.
 */
export function classifyTyperInput(inputType, value) {
    if (typeof inputType === "string" && inputType.endsWith("Backward")) {
        const removed = Math.max(TYPER_SENTINEL.length - value.length, 1);
        return { messages: Array.from({ length: removed }, () => keyMessage("Backspace")), reset: TYPER_SENTINEL };
    }
    const inserted = value.startsWith(TYPER_SENTINEL) ? value.slice(TYPER_SENTINEL.length) : value;
    return { messages: inserted ? [textMessage(inserted)] : [], reset: TYPER_SENTINEL };
}

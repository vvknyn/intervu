/**
 * Turns a tap on the watch canvas into a frame-pixel point.
 *
 * Pure and served the same way as crop.mjs so the WebRTC page and the
 * LAN page share one inversion — the two UIs must not drift apart on
 * arithmetic. The phone reports frame pixels plus the frame's own
 * dimensions; only the laptop knows the live device width, so the final
 * frame→device scaling happens there (input-sink.mjs).
 */
export function frameTapMessage({ cssX, cssY, cssWidth, crop, imageWidth, imageHeight }) {
    const view = crop ?? { sx: 0, sy: 0, sw: imageWidth, sh: imageHeight };
    const scale = view.sw / cssWidth;
    const fx = Math.round(view.sx + cssX * scale);
    const fy = Math.round(view.sy + cssY * scale);
    if (fx < 0 || fy < 0 || fx > imageWidth || fy > imageHeight) return null;
    return { v: 1, type: "tap", fx, fy, fw: imageWidth, fh: imageHeight };
}

export const textMessage = (insert) => ({ v: 1, type: "text", insert });
export const keyMessage = (key) => ({ v: 1, type: "key", key });
export const controlMessage = (on) => ({ v: 1, type: "control", on });

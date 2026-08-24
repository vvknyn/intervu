/**
 * Works out which slice of the captured screen the phone should draw.
 *
 * Mirroring the whole laptop screen does not work on a phone: the agent's
 * viewport is 1512 CSS px wide and a phone in portrait is about 390, so
 * fit-to-width renders everything at ~26% — a 14px label lands at under 4px.
 * No quality setting rescues that; the image has to be cropped, not scaled.
 *
 * Cropping to the field the agent is currently filling gets to ~78%, and it
 * is also the right thing to look at: when you are reviewing a form being
 * filled, the field being filled is the subject.
 *
 * Shared by all three clients — the LAN page (served as a module), the
 * hosted /watch page (bundled by Next), and the Node unit tests — so
 * the arithmetic has one home rather than one per client.
 */

/** Below this the crop is too tight to give any surrounding context. */
const MIN_CROP_CSS = 520;
/** Breathing room either side of the field, in CSS px. */
const PAD_CSS = 100;
/** Crop height as a multiple of its width — slightly taller than square. */
const ASPECT = 1.2;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/**
 * @param {{x:number,y:number,width:number,height:number}|null} rect
 *        Focused element box in CSS px (`getBoundingClientRect`), or null.
 * @param {{imageWidth:number, imageHeight:number, deviceWidth:number,
 *          minCropCss?:number, padCss?:number, aspect?:number}} dims
 * @returns {{sx:number,sy:number,sw:number,sh:number}|null} source rect in
 *          IMAGE px, or null meaning "draw the whole frame"
 */
export function computeCrop(rect, { imageWidth, imageHeight, deviceWidth, minCropCss = MIN_CROP_CSS, padCss = PAD_CSS, aspect = ASPECT }) {
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;

    const scale = imageWidth / deviceWidth;
    const cropW = Math.min(Math.max(rect.width + padCss * 2, minCropCss) * scale, imageWidth);
    const cropH = Math.min(cropW * aspect, imageHeight);

    const centreX = (rect.x + rect.width / 2) * scale;
    const centreY = (rect.y + rect.height / 2) * scale;

    return {
        sx: clamp(centreX - cropW / 2, 0, imageWidth - cropW),
        sy: clamp(centreY - cropH / 2, 0, imageHeight - cropH),
        sw: cropW,
        sh: cropH,
    };
}

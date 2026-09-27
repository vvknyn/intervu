/**
 * Horizontal deck drag activates only after clear horizontal intent so
 * vertical JD scroll stays native (no pointer capture on pointerdown).
 */

export const DECK_POINTER_ACTIVATE_DX_PX = 12;

export function isVerticalDominantMove(dx: number, dy: number, maxDyRatio = 0.75): boolean {
    return Math.abs(dy) > Math.abs(dx) * maxDyRatio;
}

/** True once the gesture should own horizontal drag-follow + optional capture. */
export function shouldActivateDeckHorizontalDrag(input: {
    dx: number;
    dy: number;
    alreadyActivated: boolean;
    activateDxPx?: number;
}): boolean {
    if (input.alreadyActivated) return true;
    const threshold = input.activateDxPx ?? DECK_POINTER_ACTIVATE_DX_PX;
    const adx = Math.abs(input.dx);
    if (adx < threshold) return false;
    if (isVerticalDominantMove(input.dx, input.dy)) return false;
    return true;
}

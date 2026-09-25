/**
 * Pure horizontal-swipe decision for the For-you pack deck.
 * Vertical scrolls (JD reading) must not flip cards — only a clear
 * horizontal gesture advances/retreats the deck.
 */

export const DECK_SWIPE_MIN_DX_PX = 56;
export const DECK_SWIPE_MAX_DY_RATIO = 0.75;

export type DeckSwipeDirection = "previous" | "next" | null;

/** Decide swipe direction from a completed touch/pointer gesture. */
export function resolveDeckSwipe(input: {
    dx: number;
    dy: number;
    minDx?: number;
    maxDyRatio?: number;
}): DeckSwipeDirection {
    const minDx = input.minDx ?? DECK_SWIPE_MIN_DX_PX;
    const maxDyRatio = input.maxDyRatio ?? DECK_SWIPE_MAX_DY_RATIO;
    const adx = Math.abs(input.dx);
    const ady = Math.abs(input.dy);
    if (adx < minDx) return null;
    if (ady > adx * maxDyRatio) return null;
    // Finger moves left → next card (content advances); right → previous.
    return input.dx < 0 ? "next" : "previous";
}

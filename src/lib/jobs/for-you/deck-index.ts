/**
 * Single source of truth for keeping the for-you deck's active index inside
 * the visible range after the underlying list changes size — a skip
 * removing a card, or packs reloading. An empty deck clamps to 0;
 * otherwise the index is pinned to the last valid slot rather than left
 * pointing past the end.
 *
 * This is the only place that does this arithmetic: `useForYouDeck`'s
 * resize effect calls it, and skipping relies on it rather than also
 * advancing the index itself (removing the active card from the filtered
 * list already slides the next card into the same index — advancing again
 * would skip an extra card the user never saw).
 */
export function clampDeckIndex(index: number, visibleCount: number): number {
    if (visibleCount <= 0) return 0;
    return Math.min(Math.max(index, 0), visibleCount - 1);
}

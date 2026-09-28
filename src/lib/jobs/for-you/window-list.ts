/** Estimated JobCard stride until the first row is measured. */
export const DECK_ROW_ESTIMATE_PX = 112;

export const DECK_WINDOW_OVERSCAN = 8;

/**
 * Which list rows to mount for a scrollport. A few hundred matches stay
 * smooth without changing row density — unmounted rows are padding.
 */
export function deckWindowRange(input: {
    scrollTop: number;
    viewport: number;
    count: number;
    rowHeight: number;
    overscan?: number;
}): { start: number; end: number; padTop: number; padBottom: number } {
    const count = Math.max(0, Math.floor(input.count));
    const row = Math.max(1, input.rowHeight);
    const overscan = input.overscan ?? DECK_WINDOW_OVERSCAN;
    const scrollTop = Math.max(0, input.scrollTop);
    const viewport = Math.max(0, input.viewport);
    if (count === 0) return { start: 0, end: 0, padTop: 0, padBottom: 0 };
    const start = Math.max(0, Math.floor(scrollTop / row) - overscan);
    const visible = Math.ceil(viewport / row) + overscan * 2;
    const end = Math.min(count, Math.max(start + 1, start + visible));
    return {
        start,
        end,
        padTop: start * row,
        padBottom: Math.max(0, count - end) * row,
    };
}

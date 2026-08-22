export interface HighlightSegment {
    text: string;
    matched: boolean;
}

/**
 * Splits `text` into segments around the first case-insensitive occurrence
 * of `query`, so a caller can render the matched substring distinctly (e.g.
 * bold, or `<mark>`) from the rest of the string — the autosuggest dropdown
 * highlighting what the searcher actually typed inside a longer suggestion
 * (item 6c, 2026-08-21 front-door audit). Returns `text` as a single
 * unmatched segment when `query` is empty or not found in `text`, so a
 * caller never needs its own fallback branch for those cases.
 */
export function highlightMatch(text: string, query: string): HighlightSegment[] {
    const q = query.trim();
    if (!q) return [{ text, matched: false }];
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return [{ text, matched: false }];

    const segments: HighlightSegment[] = [];
    if (idx > 0) segments.push({ text: text.slice(0, idx), matched: false });
    segments.push({ text: text.slice(idx, idx + q.length), matched: true });
    if (idx + q.length < text.length) segments.push({ text: text.slice(idx + q.length), matched: false });
    return segments;
}

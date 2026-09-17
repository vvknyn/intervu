/**
 * Thousands-separated integer for on-page counts (e.g. "12,345"). One
 * formatter so every count on a given surface renders identically instead of
 * each call site hand-rolling its own `.toLocaleString()`.
 */
export function formatCount(n: number): string {
    return n.toLocaleString();
}

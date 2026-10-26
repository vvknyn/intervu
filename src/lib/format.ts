/**
 * Thousands-separated integer for on-page counts (e.g. "12,345"). One
 * formatter so every count on a given surface renders identically instead of
 * each call site hand-rolling its own `.toLocaleString()`.
 */
export function formatCount(n: number): string {
    return n.toLocaleString("en-US");
}

/**
 * "Aug 15, 2026" from an ISO-8601 stamp — same rules as the news card's
 * `articleDate` (always show the year; render in UTC so a viewer-local render
 * can't roll the date back a day). Returns null on an unparseable stamp so the
 * caller omits the line instead of printing "Invalid Date".
 *
 * The year matters more here than anywhere else on the page: "hiring has
 * stalled" reads as a statement about *now*, and a bare "Aug 15" on a
 * two-year-old freeze would be the page's most misleading line.
 */
export function eventDate(iso: string): string | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Closing a job on /jobs. Opening one from the list pushes `?job=<id>`, so
 * Back is the close: it returns to the list and a later Forward reopens the
 * job. A job opened from a shared link has no Velai entry before it, and Back
 * there left the site (or did nothing in a fresh tab), so the close drops
 * `?job=` in place instead (2026-09-30).
 */

/** History-state flag `JobsContent` sets on the entries it pushes itself. */
export const PUSHED_IN_APP = "velaiPushed";

interface HistoryWindow {
    history: { state: unknown };
    /** The Navigation API, where the browser has it. */
    navigation?: { canGoBack?: unknown };
}

/**
 * Whether the entry before this one is a Velai page. The Navigation API
 * answers directly: `canGoBack` counts only same-origin entries. Without it,
 * only an entry `JobsContent` pushed itself is known to have one of ours
 * before it, so any other entry drops `?job=` in place, which never leaves
 * the site.
 */
export function previousEntryIsOurs(win: HistoryWindow): boolean {
    const canGoBack = win.navigation?.canGoBack;
    if (typeof canGoBack === "boolean") return canGoBack;
    const state = win.history.state;
    return typeof state === "object" && state !== null && (state as Record<string, unknown>)[PUSHED_IN_APP] === true;
}

/** The current path and query without `job`, every other param kept. */
export function urlWithoutJob(location: { pathname: string; search: string }): string {
    const params = new URLSearchParams(location.search);
    params.delete("job");
    const query = params.toString();
    return query ? `${location.pathname}?${query}` : location.pathname;
}

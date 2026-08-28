/**
 * Pure decision for what a `loadMore` fetch on /jobs actually got back.
 *
 * The anonymous depth cap (lib/shield/depth-cap.ts) can refuse a page
 * outright once an unauthenticated searcher's offset reaches its wall —
 * that response's `hits`/`total` are not a real (if empty) page, they're a
 * refusal, and the client must never treat it as "nothing left to show."
 * The ONLY gate signal is the server's own `meta.gated` flag on that
 * response — this module holds no copy of the 90/30 depth-cap numbers, so
 * there is exactly one place (depth-cap.ts) that can ever disagree with
 * itself about where the wall sits.
 *
 * A short page that ISN'T gated (fewer hits than requested, `gated: false`)
 * is the ordinary, honest end of the corpus — `"exhausted"` — and must not
 * be confused with a refusal.
 */
export type LoadMoreOutcome = "gated" | "appended" | "exhausted";

export interface LoadMoreResponseShape {
    /** The server's own `meta.gated` — true when this page was refused, not searched. */
    gated: boolean;
    /** Hits actually returned by this fetch. */
    received: number;
    /** Hits this fetch asked the server for. */
    requested: number;
}

export function interpretLoadMoreResponse({ gated, received, requested }: LoadMoreResponseShape): LoadMoreOutcome {
    if (gated) return "gated";
    return received < requested ? "exhausted" : "appended";
}

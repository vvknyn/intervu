/**
 * Client-side timeout for a `/jobs` server-action call. Guards against a
 * Next.js Server Action POST that never settles — observed in prod as an
 * edge-level 503 that the client's own fetch layer never surfaces as an
 * error, because the request is dropped before Next's action machinery gets
 * a chance to run/report anything back. Meilisearch-level failures are
 * already handled a layer down (search.ts wraps them into a
 * `configured: true` result with a `note`); this guards the layer ABOVE
 * that — the action invocation itself never resolving or rejecting, which
 * would otherwise leave the page's `loading` state (and its spinner) stuck
 * forever.
 *
 * (2026-09-18: id-scoped detail lookups no longer use this file at all —
 * they moved off the Server Action queue onto a plain `fetch` to `GET
 * /api/jobs/[id]/description`, which owns its own `DETAIL_FETCH_TIMEOUT_MS`
 * deadline in lib/jobs/detail-fetch.ts. This guard's own doc history is
 * why: a detail lookup invoked at 5.4s, dispatched at 8.1s behind 14 queued
 * actions, server-answered at 10.2s, landed at 18.3s — Next's client action
 * queue is strictly serial FIFO, and queue wait counted against whatever
 * budget this guard gave that call. A route handler has its own connection
 * and no such queue to wait behind, so that failure mode no longer applies
 * to this call site — this guard now only wraps the general list-search
 * actions below, which never carried that problem.)
 */
export const ACTION_SETTLE_TIMEOUT_MS = 15_000;

/**
 * Race any promise against `timeoutMs`; on timeout, REJECTS (never
 * fabricates a result) so callers route through their EXISTING catch-based
 * error handling — the same `searchError` → Retry UI path a genuine thrown
 * error already takes (see src/app/jobs/page.tsx) — without a second
 * error-shape to branch on.
 */
export function withSettleGuard<T>(promise: Promise<T>, timeoutMs: number = ACTION_SETTLE_TIMEOUT_MS): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`Request did not settle within ${timeoutMs}ms`)),
            timeoutMs,
        );
        promise.then(
            (v) => {
                clearTimeout(timer);
                resolve(v);
            },
            (e) => {
                clearTimeout(timer);
                reject(e);
            },
        );
    });
}

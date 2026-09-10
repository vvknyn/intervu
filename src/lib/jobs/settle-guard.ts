import { DESCRIPTION_FILL_VISIBLE_DEADLINE_MS } from "./fill-description";

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
 */
export const ACTION_SETTLE_TIMEOUT_MS = 15_000;

/**
 * Budget for an id-scoped DETAIL lookup (jobs/page.tsx's dead-job check +
 * on-demand hydrate, yours/[id]/page.tsx's open + retry) — never the plain
 * `ACTION_SETTLE_TIMEOUT_MS`. Server-side, that lookup may legitimately
 * block for the FULL `DESCRIPTION_FILL_VISIBLE_DEADLINE_MS` fill deadline
 * ON TOP OF the never-settles budget above, which exists for a request that
 * hangs for an unrelated reason. Worse: `withSettleGuard`'s clock starts at
 * INVOCATION, and Next's client action queue is strictly serial FIFO — the
 * POST doesn't leave the browser until every earlier-queued action settles,
 * so queue wait counts against the budget too. Measured on prod: a detail
 * lookup invoked at 5.4s, dispatched at 8.1s behind 14 queued actions,
 * server-answered at 10.2s, landed at 18.3s — the plain 15s list-search
 * budget discarded a valid, slow-filling answer as "unknown". Adding the
 * two deadlines gives this lookup room for both the queue wait and the full
 * server-side fill before it gives up.
 */
export const DETAIL_SETTLE_TIMEOUT_MS = ACTION_SETTLE_TIMEOUT_MS + DESCRIPTION_FILL_VISIBLE_DEADLINE_MS;

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

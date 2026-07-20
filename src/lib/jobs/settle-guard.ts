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

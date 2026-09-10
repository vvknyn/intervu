import { runExistenceCheck, type ExistenceCheckStatus } from "@/lib/jobs/result-state";
import { withSettleGuard, DETAIL_SETTLE_TIMEOUT_MS } from "@/lib/jobs/settle-guard";

/**
 * Dedupes concurrent `runExistenceCheck` calls for the same job id — the
 * "prefetch on intent" chokepoint jobs/page.tsx primes from `openJob` and
 * `retryDescription` so the description-bearing `searchJobsAction` POST is
 * the FIRST server action dispatched (Next's client action queue runs
 * actions strictly serially; see page.tsx's priming call sites).
 *
 * Two semantics, both load-bearing: a call for an id already IN FLIGHT
 * joins that same request (one network call, every caller gets the same
 * result); a call for an id whose prior request already SETTLED starts a
 * NEW request — nothing is cached past settlement, which is what makes a
 * retry ("try again" after a timed-out fill) actually re-fetch.
 *
 * Owns its OWN settle budget (`settleMs`, default `DETAIL_SETTLE_TIMEOUT_MS`)
 * rather than inheriting whatever guard the caller's `search` action already
 * carries — a list-search wrapper's `ACTION_SETTLE_TIMEOUT_MS` guard is
 * sized for a SERP fetch, not for an id lookup that can legitimately block
 * for the server's full description-fill deadline on top of that. `search`
 * is wrapped in `withSettleGuard` here, BEFORE it reaches `run`, so a
 * timeout still flows through `runExistenceCheck`'s existing catch →
 * `"unknown"` path instead of needing a second timeout branch. Callers MUST
 * pass the RAW action (no settle-guard of its own) — double-wrapping would
 * silently cap this budget back down to the inner guard's shorter timeout.
 */
export function createDetailFetcher(run: typeof runExistenceCheck = runExistenceCheck, settleMs: number = DETAIL_SETTLE_TIMEOUT_MS) {
    const inFlight = new Map<string, Promise<ExistenceCheckStatus>>();
    return {
        fetch(id: string, search: Parameters<typeof runExistenceCheck>[1]): Promise<ExistenceCheckStatus> {
            const existing = inFlight.get(id);
            if (existing) return existing;
            const guardedSearch: Parameters<typeof runExistenceCheck>[1] = (q) => withSettleGuard(search(q), settleMs);
            const promise = run(id, guardedSearch).finally(() => inFlight.delete(id));
            inFlight.set(id, promise);
            return promise;
        },
    };
}

export const detailFetcher = createDetailFetcher();

import { runExistenceCheck, type ExistenceCheckStatus } from "@/lib/jobs/result-state";

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
 */
export function createDetailFetcher(run: typeof runExistenceCheck = runExistenceCheck) {
    const inFlight = new Map<string, Promise<ExistenceCheckStatus>>();
    return {
        fetch(id: string, search: Parameters<typeof runExistenceCheck>[1]): Promise<ExistenceCheckStatus> {
            const existing = inFlight.get(id);
            if (existing) return existing;
            const promise = run(id, search).finally(() => inFlight.delete(id));
            inFlight.set(id, promise);
            return promise;
        },
    };
}

export const detailFetcher = createDetailFetcher();

import { classifyExistenceCheck, type ExistenceCheckStatus } from "@/lib/jobs/result-state";
import type { JobSearchResult } from "@/lib/jobs/types";

/** Client-side deadline for the `GET /api/jobs/[id]/description` transport
 *  below. A plain fetch to a route handler, not a Server Action — no serial
 *  action-queue wait to budget for (see detail-fetch's git history / the
 *  removed `DETAIL_SETTLE_TIMEOUT_MS` in settle-guard.ts), just the route's
 *  own worst case: a full `DESCRIPTION_FILL_VISIBLE_DEADLINE_MS` (10s)
 *  server-side fill plus headroom for real network latency. */
export const DETAIL_FETCH_TIMEOUT_MS = 12_000;

/** Bounded memo capacity (~50 entries): enough to cover a session's worth of
 *  opened/peeked jobs without growing unbounded across a long-lived SPA
 *  session. Eviction is FIFO via `Map`'s insertion order (oldest key first),
 *  not true LRU — cheap and good enough for a cache whose job is avoiding
 *  redundant refetches, not maximizing hit rate under adversarial access
 *  patterns. */
export const DETAIL_MEMO_LIMIT = 50;

/**
 * Pure decision: which `ExistenceCheckStatus` values may be memoized past
 * settlement. Never `"unknown"` — an inconclusive or failed check must be
 * retried, not cached as fact (same fail-safe posture `classifyExistenceCheck`
 * itself documents). Never a `"found"` whose description is still pending —
 * caching that would permanently shadow a later, complete answer for the
 * rest of the session.
 */
export function isCacheableExistenceCheck(status: ExistenceCheckStatus): boolean {
    if (status.status === "unknown") return false;
    if (status.status === "found" && status.descriptionPending) return false;
    return true;
}

/**
 * Dedupes concurrent lookups for the same job id — the shared chokepoint
 * every id-scoped detail fetch goes through (jobs/page.tsx's dead-job check,
 * SERP-hydrate, and retry; yours/[id]/page.tsx's open + retry). Transport is
 * a plain `fetch` to `GET /api/jobs/[id]/description` (a route handler, not
 * a Server Action — see that route's doc comment for why), classified via
 * the same `classifyExistenceCheck` the action's own JSON shape always
 * satisfied.
 *
 * Two cache layers, both keyed by id:
 *  - `inFlight`: a call for an id already IN FLIGHT joins that same
 *    request — one network call, every caller gets the same result.
 *  - `memo`: a call for an id whose prior request already settled to a
 *    CACHEABLE result (`isCacheableExistenceCheck`) is served from memory,
 *    no network at all. A `"unknown"` or still-pending result is never
 *    stored here, so a retry ("try again" after a timeout) always re-fetches
 *    — nothing before settlement is ever treated as final.
 *
 * `fetchImpl` is injected (defaults to the global `fetch`) so this stays a
 * plain unit-tested function with no real-network dependency — same
 * reasoning `runExistenceCheck`'s own injected `search` parameter documents
 * (lib/jobs/result-state.ts).
 */
export function createDetailFetcher(
    fetchImpl: typeof fetch = fetch,
    timeoutMs: number = DETAIL_FETCH_TIMEOUT_MS,
    memoLimit: number = DETAIL_MEMO_LIMIT,
) {
    const inFlight = new Map<string, Promise<ExistenceCheckStatus>>();
    const memo = new Map<string, ExistenceCheckStatus>();

    async function fetchStatus(id: string): Promise<ExistenceCheckStatus> {
        try {
            const res = await fetchImpl(`/api/jobs/${encodeURIComponent(id)}/description`, {
                signal: AbortSignal.timeout(timeoutMs),
            });
            if (!res.ok) return { status: "unknown" };
            const body = (await res.json()) as JobSearchResult & { descriptionPending?: boolean };
            return classifyExistenceCheck(id, body);
        } catch {
            // Network error, non-JSON body, or the abort deadline firing —
            // all inconclusive, never a false "not found" (same contract
            // `runExistenceCheck` documents).
            return { status: "unknown" };
        }
    }

    return {
        fetch(id: string): Promise<ExistenceCheckStatus> {
            const cached = memo.get(id);
            if (cached) return Promise.resolve(cached);

            const existing = inFlight.get(id);
            if (existing) return existing;

            const promise = fetchStatus(id)
                .then((status) => {
                    if (isCacheableExistenceCheck(status)) {
                        if (memo.size >= memoLimit) {
                            const oldestKey = memo.keys().next().value;
                            if (oldestKey !== undefined) memo.delete(oldestKey);
                        }
                        memo.set(id, status);
                    }
                    return status;
                })
                .finally(() => inFlight.delete(id));
            inFlight.set(id, promise);
            return promise;
        },
    };
}

export const detailFetcher = createDetailFetcher();

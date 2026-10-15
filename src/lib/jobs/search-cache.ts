/**
 * Last-good-response cache for the Meilisearch read path.
 *
 * Context: the shared Meilisearch box goes saturated for hours at a time
 * during full-corpus embeds (see MEMORY meili-embed-freeze-jul29) and the
 * first prod search during that window hit the dead-end
 * `SEARCH_UNAVAILABLE_MESSAGE` path in search.ts even though the corpus
 * itself hadn't changed. This module lets `searchJobs` serve the last
 * successful response for a query — or, for a plain default browse only, the
 * last successful default-browse response — instead of an empty error screen,
 * once `meiliFetch`'s own retry (meilisearch.ts) has already been exhausted.
 *
 * A request with a query or any filter never gets another request's rows:
 * the newest-jobs list served as a job pack's result was ranked against the
 * résumé and counted as the pack's matches (2026-09-30). Without its own
 * cached response it gets the unavailable result, which the UI shows as an
 * error with Retry.
 *
 * Module-scope, in-memory, bounded LRU — no cross-instance sharing, no
 * persistence. That's deliberate: this is a shock absorber for an outage
 * window on ONE server instance, not a cache correctness guarantee.
 */
import { renderPlaceClause } from "./meilisearch";
import type { FacetKey, JobSearchParams, JobSearchResult } from "./types";

/** Bound on the LRU — single source of truth, referenced by the eviction
 *  loop below and by tests. */
export const SEARCH_CACHE_MAX_ENTRIES = 200;

/** Well-known key for the "default browse" shape (no query, no filters) —
 *  the fallback served for a degraded default browse (first page) when its
 *  own exact key hasn't been cached yet. See `resolveDegradedServe`. */
const DEFAULT_BROWSE_CACHE_KEY = "\x00default-browse\x00";

interface CacheEntry {
  result: JobSearchResult;
  cachedAtMs: number;
}

// Map preserves insertion order, which is what makes the delete+re-set
// "touch" below double as LRU bookkeeping: the oldest untouched entry is
// always `cache.keys().next().value`.
const cache = new Map<string, CacheEntry>();

function touch(key: string, entry: CacheEntry): void {
  cache.delete(key);
  cache.set(key, entry);
  while (cache.size > SEARCH_CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/**
 * Pure: canonical cache key for a search request. Order-independent
 * (sorted facet/place values) and normalized (trimmed/lowercased query,
 * defaulted pagination) so two requests that would produce the identical
 * Meilisearch call also produce the identical key.
 */
export function normalizeSearchCacheKey(p: JobSearchParams): string {
  const facets: Partial<Record<FacetKey, string[]>> = {};
  for (const key of Object.keys(p.facets ?? {}).sort() as FacetKey[]) {
    const vals = p.facets?.[key];
    if (vals?.length) facets[key] = [...vals].sort();
  }
  // Rendered through `renderPlaceClause` — the same function that builds the
  // real filter — rather than re-listing a clause's fields here. This key's
  // contract (above) is that two requests producing the identical
  // Meilisearch call produce the identical key, and the only thing that
  // knows what a clause becomes in that call is the renderer. A hand-written
  // copy silently breaks that promise the moment `PlaceClause` grows a
  // field: when `workTypes` was added, a key listing only
  // `any`/`scopedToCountry` would have collided "remote Canada" with
  // "hybrid Canada" and served one the other's results.
  //
  // Each clause's own sub-lists are order-sensitive (they came out of
  // validation in a stable order for the SAME candidate set), so only the
  // top-level clause ordering needs normalizing here.
  const places = (p.places ?? []).map(renderPlaceClause).sort();
  return JSON.stringify({
    q: (p.q ?? "").trim().toLowerCase(),
    id: p.id ?? "",
    facets,
    salaryMin: p.salaryMin || 0,
    visaOnly: Boolean(p.visaOnly),
    hideGhosts: Boolean(p.hideGhosts),
    sort: p.sort ?? "",
    postedBucket: p.postedBucket ?? "",
    postedSinceMs: p.postedSinceMs ?? 0,
    places,
    yearsExperience: p.yearsExperience ?? "",
    // Order kept: each phrase is a lane, and the lanes interleave in this order.
    fitPhrases: p.fitPhrases ?? [],
    // Changes which rows the lanes pool, so a résumé-built list never shares an entry with the same words searched plain.
    omitPastSenior: Boolean(p.omitPastSenior),
    limit: p.limit ?? 40,
    offset: p.offset ?? 0,
    withFacets: Boolean(p.withFacets),
    board: p.board ?? "",
    companyDomain: (p.companyDomain ?? "").trim().toLowerCase(),
    companyDomains: [...(p.companyDomains ?? [])].map((d) => d.trim().toLowerCase()).sort(),
  });
}

/** Pure: is this the plain default-browse request (no query, no filters)?
 *  That shape is the one worth caching under the well-known fallback key —
 *  it's the response most degraded requests should fall back to when their
 *  own exact key was never populated. */
export function isDefaultBrowseParams(p: JobSearchParams): boolean {
  return (
    !p.q?.trim() &&
    !p.id &&
    !p.facets &&
    !p.salaryMin &&
    !p.visaOnly &&
    !p.postedBucket &&
    !p.postedSinceMs &&
    !p.places?.length &&
    !p.board &&
    !p.companyDomain &&
    !(p.companyDomains?.length ?? 0)
  );
}

/**
 * Record a successful Meilisearch response under its own key, and — when
 * the request was the default-browse shape — also under the fallback key.
 * Caller (search.ts) only invokes this on the success path; never on an
 * `unavailable`/error result, so the cache can never learn a failure as a
 * "last good" answer.
 */
export function cacheSearchResult(p: JobSearchParams, result: JobSearchResult, nowMs = Date.now()): void {
  const entry: CacheEntry = { result, cachedAtMs: nowMs };
  touch(normalizeSearchCacheKey(p), entry);
  if (isDefaultBrowseParams(p)) touch(DEFAULT_BROWSE_CACHE_KEY, entry);
}

/** Health signal attached to a search action's success result — additive,
 *  never replaces an existing `JobSearchResult` field. See search.ts's
 *  `searchJobs` for the write side. */
export interface SearchServeMeta {
  degraded: boolean;
  servedFrom: "live" | "cache";
  cachedAtMs?: number;
}

export interface DegradedServeDecision {
  result: JobSearchResult;
  cachedAtMs: number;
  /** Which lookup matched — "exact" means `result` was cached under THIS
   *  request's own (already location-filtered) key, so it's safe for the
   *  caller to re-stamp with the current request's derived fields (e.g. an
   *  IP-based location default). "default-browse" means `result` is the
   *  unfiltered fallback shape; the caller must NOT claim anything about
   *  the current request over it, or the served content would misrepresent
   *  itself (see search.ts's `searchJobs` for the read side). */
  servedKey: "exact" | "default-browse";
}

/**
 * Pure decision: given a Meilisearch failure for request `p`, what — if
 * anything — should be served from cache? `lookup` is injected (not the
 * module-scope `cache` directly) so this is unit-testable without touching
 * Meilisearch or the module singleton. Exact key first, then — only for a
 * first page of the default browse itself — the default-browse fallback,
 * else `null` (caller returns the unavailable result).
 *
 * The fallback is never served for a query, a filter, a place or a later
 * page: those rows would not be this request's, and callers that rank or
 * count a result (the job-pack list, fit sort, the fit gate) cannot tell.
 */
export function resolveDegradedServe(
  p: JobSearchParams,
  lookup: (key: string) => CacheEntry | undefined,
): DegradedServeDecision | null {
  const exact = lookup(normalizeSearchCacheKey(p));
  if (exact) return { ...exact, servedKey: "exact" };
  if (!isDefaultBrowseParams(p) || (p.offset ?? 0) > 0) return null;
  const fallback = lookup(DEFAULT_BROWSE_CACHE_KEY);
  return fallback ? { ...fallback, servedKey: "default-browse" } : null;
}

/** Thin I/O wrapper: `resolveDegradedServe` wired to the real module-scope cache. */
export function getDegradedServe(p: JobSearchParams): DegradedServeDecision | null {
  return resolveDegradedServe(p, (key) => cache.get(key));
}

/**
 * How long a live answer stays the answer for the same search. Visitors
 * running the same search (a job pack, the newest list, the probes every list
 * search runs beside it) inside this window share one Meilisearch call
 * instead of each making their own, so a crowd costs the search box what
 * one visitor does.
 */
export const SEARCH_FRESH_MS = 15_000;
let freshMs = SEARCH_FRESH_MS;
const inFlight = new Map<string, Promise<JobSearchResult>>();

/**
 * One Meilisearch call for identical searches: a live answer younger than
 * `SEARCH_FRESH_MS` is reused, a call already on its way is joined, and
 * otherwise `run` makes a new one, whose success becomes the last-good
 * answer `getDegradedServe` falls back on. A failure is never reused: every
 * caller waiting on it gets the failure, and the next search calls again.
 */
export function sharedLiveSearch(
  p: JobSearchParams,
  run: () => Promise<JobSearchResult>,
  nowMs = Date.now(),
): Promise<JobSearchResult> {
  const key = normalizeSearchCacheKey(p);
  const fresh = cache.get(key);
  if (fresh && nowMs - fresh.cachedAtMs < freshMs) return Promise.resolve(fresh.result);
  const pending = inFlight.get(key);
  if (pending) return pending;
  const call = run()
    .then((result) => {
      cacheSearchResult(p, result);
      return result;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, call);
  return call;
}

export function clearSearchCacheForTests(): void {
  cache.clear();
  inFlight.clear();
}

/** Tests that search twice to reach the outage path turn sharing off (0). */
export function setSearchFreshMsForTests(ms: number): void {
  freshMs = ms;
}

/**
 * Last-good-response cache for the Meilisearch read path.
 *
 * Context: the shared Meilisearch box goes saturated for hours at a time
 * during full-corpus embeds (see MEMORY meili-embed-freeze-jul29) and the
 * first prod search during that window hit the dead-end
 * `SEARCH_UNAVAILABLE_MESSAGE` path in search.ts even though the corpus
 * itself hadn't changed. This module lets `searchJobs` serve the last
 * successful response for a query — or, failing that, the last successful
 * default-browse response — instead of an empty error screen, once
 * `meiliFetch`'s own retry (meilisearch.ts) has already been exhausted.
 *
 * Module-scope, in-memory, bounded LRU — no cross-instance sharing, no
 * persistence. That's deliberate: this is a shock absorber for an outage
 * window on ONE server instance, not a cache correctness guarantee.
 */
import type { FacetKey, JobSearchParams, JobSearchResult } from "./types";

/** Bound on the LRU — single source of truth, referenced by the eviction
 *  loop below and by tests. */
export const SEARCH_CACHE_MAX_ENTRIES = 200;

/** Well-known key for the "default browse" shape (no query, no filters) —
 *  the fallback served for ANY degraded request when its own exact key
 *  hasn't been cached yet. */
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
  // Each clause's own `any`/`scopedToCountry` sub-lists are order-sensitive
  // (they came out of validation in a stable order for the SAME candidate
  // set), so only the top-level clause ordering needs normalizing here.
  const places = (p.places ?? [])
    .map(
      (c) =>
        `${c.any.map((pl) => `${pl.field}:${pl.value}`).join(",")}` +
        (c.scopedToCountry?.length ? `|${c.scopedToCountry.map((pl) => `${pl.field}:${pl.value}`).join(",")}` : ""),
    )
    .sort();
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
    limit: p.limit ?? 40,
    offset: p.offset ?? 0,
    withFacets: Boolean(p.withFacets),
    board: p.board ?? "",
    companyDomain: (p.companyDomain ?? "").trim().toLowerCase(),
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
    !p.companyDomain
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
}

/**
 * Pure decision: given a Meilisearch failure for request `p`, what — if
 * anything — should be served from cache? `lookup` is injected (not the
 * module-scope `cache` directly) so this is unit-testable without touching
 * Meilisearch or the module singleton. Exact key first, then the
 * default-browse fallback, else `null` (caller keeps its existing error
 * path unchanged).
 */
export function resolveDegradedServe(
  p: JobSearchParams,
  lookup: (key: string) => CacheEntry | undefined,
): DegradedServeDecision | null {
  const exact = lookup(normalizeSearchCacheKey(p));
  if (exact) return exact;
  return lookup(DEFAULT_BROWSE_CACHE_KEY) ?? null;
}

/** Thin I/O wrapper: `resolveDegradedServe` wired to the real module-scope cache. */
export function getDegradedServe(p: JobSearchParams): DegradedServeDecision | null {
  return resolveDegradedServe(p, (key) => cache.get(key));
}

export function clearSearchCacheForTests(): void {
  cache.clear();
}

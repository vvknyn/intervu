import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cacheSearchResult,
  clearSearchCacheForTests,
  getDegradedServe,
  isDefaultBrowseParams,
  normalizeSearchCacheKey,
  resolveDegradedServe,
  SEARCH_CACHE_MAX_ENTRIES,
} from "../../src/lib/jobs/search-cache";
import type { JobSearchParams, JobSearchResult } from "../../src/lib/jobs/types";

function makeResult(total: number): JobSearchResult {
  return { hits: [], total, backend: "meilisearch", configured: true, effectiveQ: "" };
}

test("normalizeSearchCacheKey: order-independent across facets and places", () => {
  const a: JobSearchParams = {
    q: "  Product Manager  ",
    facets: { work_type: ["remote", "hybrid"], source: ["lever_direct"] },
    places: [
      { any: [{ field: "location_city", value: "Toronto" }], scopedToCountry: [{ field: "location_country", value: "Canada" }] },
      { any: [{ field: "location_country", value: "Canada" }] },
    ],
  };
  const b: JobSearchParams = {
    q: "product manager",
    facets: { source: ["lever_direct"], work_type: ["hybrid", "remote"] },
    places: [
      { any: [{ field: "location_country", value: "Canada" }] },
      { any: [{ field: "location_city", value: "Toronto" }], scopedToCountry: [{ field: "location_country", value: "Canada" }] },
    ],
  };
  assert.equal(normalizeSearchCacheKey(a), normalizeSearchCacheKey(b));
});

test("normalizeSearchCacheKey: distinguishes requests that would hit Meilisearch differently", () => {
  const base: JobSearchParams = { q: "engineer" };
  const distinctions: JobSearchParams[] = [
    { q: "engineer", visaOnly: true },
    { q: "engineer", hideGhosts: true },
    { q: "engineer", salaryMin: 100_000 },
    { q: "engineer", postedBucket: "7d" },
    { q: "engineer", postedSinceMs: 1_800_000_000_000 },
    { q: "engineer", offset: 40 },
    { q: "engineer", board: "elite" },
    { q: "engineer", companyDomain: "stripe.com" },
    { q: "designer" },
  ];
  const baseKey = normalizeSearchCacheKey(base);
  for (const p of distinctions) {
    assert.notEqual(normalizeSearchCacheKey(p), baseKey, JSON.stringify(p));
  }
});

test("isDefaultBrowseParams: true only for the empty-query, no-filter shape", () => {
  assert.equal(isDefaultBrowseParams({}), true);
  assert.equal(isDefaultBrowseParams({ q: "   " }), true);
  assert.equal(isDefaultBrowseParams({ q: "engineer" }), false);
  assert.equal(isDefaultBrowseParams({ visaOnly: true }), false);
  assert.equal(isDefaultBrowseParams({ facets: { work_type: ["remote"] } }), false);
  assert.equal(isDefaultBrowseParams({ companyDomain: "stripe.com" }), false);
  // countNewSinceAction's board-scope count sets ONLY postedSinceMs (+
  // optionally `places`, which is already covered above) — regression
  // guard: without this, that limit:1 count response would silently
  // overwrite the shared default-browse degraded-serve fallback key.
  assert.equal(isDefaultBrowseParams({ postedSinceMs: 1_800_000_000_000 }), false);
});

test("resolveDegradedServe: pure decision — exact hit, then default fallback, then null", () => {
  const p: JobSearchParams = { q: "engineer" };
  const exactEntry = { result: makeResult(3), cachedAtMs: 111 };
  const defaultEntry = { result: makeResult(9), cachedAtMs: 222 };
  const store = new Map([
    [normalizeSearchCacheKey(p), exactEntry],
    ["\x00default-browse\x00", defaultEntry],
  ]);

  // Exact key present → served, not the default.
  assert.deepEqual(resolveDegradedServe(p, (k) => store.get(k)), { ...exactEntry, servedKey: "exact" });

  // Exact key missing for a DIFFERENT query → falls back to default browse.
  const other: JobSearchParams = { q: "designer" };
  assert.deepEqual(resolveDegradedServe(other, (k) => store.get(k)), { ...defaultEntry, servedKey: "default-browse" });

  // Nothing cached at all → null, caller's existing error path is untouched.
  assert.equal(resolveDegradedServe(other, () => undefined), null);
});

// The `servedKey` contract itself — search.ts (`searchJobs`) branches on
// this to decide whether `defaultedLocation` is safe to re-stamp onto a
// degraded-serve response: "exact" was cached under THIS request's own
// (already location-filtered) key, so claiming the current request's
// default over it is true; "default-browse" is the unfiltered fallback, and
// claiming a location over it would misrepresent what's actually shown.
test("resolveDegradedServe: servedKey distinguishes an exact hit from a default-browse fallback", () => {
  const p: JobSearchParams = { q: "nurse" };
  const exactEntry = { result: makeResult(3), cachedAtMs: 111 };
  const defaultEntry = { result: makeResult(9), cachedAtMs: 222 };
  const store = new Map([
    [normalizeSearchCacheKey(p), exactEntry],
    ["\x00default-browse\x00", defaultEntry],
  ]);

  assert.equal(resolveDegradedServe(p, (k) => store.get(k))?.servedKey, "exact");
  assert.equal(resolveDegradedServe({ q: "designer" }, (k) => store.get(k))?.servedKey, "default-browse");
});

test("cacheSearchResult + getDegradedServe: write path feeds the real module cache", () => {
  clearSearchCacheForTests();
  const p: JobSearchParams = { q: "recruiter" };
  const result = makeResult(7);

  assert.equal(getDegradedServe(p), null, "nothing cached yet");
  cacheSearchResult(p, result, 1_000);
  const served = getDegradedServe(p);
  assert.equal(served?.result.total, 7);
  assert.equal(served?.cachedAtMs, 1_000);
});

test("cacheSearchResult: a default-browse request also seeds the fallback for a DIFFERENT unseen query", () => {
  clearSearchCacheForTests();
  cacheSearchResult({}, makeResult(42), 5_000);
  const served = getDegradedServe({ q: "never searched before" });
  assert.equal(served?.result.total, 42, "unseen query falls back to the cached default browse");
});

test("cacheSearchResult: LRU is bounded — oldest entry evicted once over the cap", () => {
  clearSearchCacheForTests();
  for (let i = 0; i < SEARCH_CACHE_MAX_ENTRIES + 1; i++) {
    cacheSearchResult({ q: `query-${i}` }, makeResult(i), i);
  }
  // The very first key inserted should have been evicted...
  assert.equal(getDegradedServe({ q: "query-0" }), null, "oldest entry evicted over the bound");
  // ...while the most recent one is still there.
  const last = SEARCH_CACHE_MAX_ENTRIES;
  const served = getDegradedServe({ q: `query-${last}` });
  assert.equal(served?.result.total, last);
});

/* ────────────────────────────────────────────────────────────────────────
 * Place clauses reach the key through `renderPlaceClause`, the same function
 * that builds the real filter — so a clause field can never be filtered on
 * but forgotten by the key.
 * ──────────────────────────────────────────────────────────────────────── */

test("two places that differ ONLY by their bound work mode get different keys", () => {
  // The collision a hand-written key would have shipped: both requests carry
  // the same single Canada clause, so a key listing only `any`/
  // `scopedToCountry` renders them identical and serves one the other's
  // results.
  const canada = { field: "location_country" as const, value: "Canada" };
  const remote: JobSearchParams = { places: [{ any: [canada], workTypes: ["remote"] }] };
  const hybrid: JobSearchParams = { places: [{ any: [canada], workTypes: ["hybrid"] }] };
  assert.notEqual(normalizeSearchCacheKey(remote), normalizeSearchCacheKey(hybrid));
});

test("a bound work mode is distinct from no work mode at all", () => {
  const canada = { field: "location_country" as const, value: "Canada" };
  const bare: JobSearchParams = { places: [{ any: [canada] }] };
  const bound: JobSearchParams = { places: [{ any: [canada], workTypes: ["remote"] }] };
  assert.notEqual(normalizeSearchCacheKey(bare), normalizeSearchCacheKey(bound));
});

test("the same two places in either order still share one key", () => {
  // Top-level clause order is normalized, so asking for Canada-then-Toronto
  // and Toronto-then-Canada is one cached search, not two.
  const canada = { any: [{ field: "location_country" as const, value: "Canada" }] };
  const toronto = { any: [{ field: "location_city" as const, value: "Toronto" }] };
  assert.equal(
    normalizeSearchCacheKey({ places: [canada, toronto] }),
    normalizeSearchCacheKey({ places: [toronto, canada] }),
  );
});

test("a global work_type facet is not interchangeable with the same mode bound to a place", () => {
  // Different filters — (remote) AND (Canada OR Toronto) vs
  // (Canada AND remote) OR (Toronto) — so different keys.
  const canada = { field: "location_country" as const, value: "Canada" };
  const global: JobSearchParams = { places: [{ any: [canada] }], facets: { work_type: ["remote"] } };
  const bound: JobSearchParams = { places: [{ any: [canada], workTypes: ["remote"] }] };
  assert.notEqual(normalizeSearchCacheKey(global), normalizeSearchCacheKey(bound));
});

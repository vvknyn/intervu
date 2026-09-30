/**
 * The dropped-`defaultedLocation` bug: `searchJobs` (search.ts) resolves the
 * IP-based location default BEFORE the try block, then only spread it onto
 * the success returns — both failure branches (degraded cache serve,
 * unavailable) silently dropped it, so a prod Meili blip made the "near
 * <Country>" chip vanish even though the request had been correctly
 * understood. The fix's asymmetry is the point under test here: an "exact"
 * degraded-cache hit (cached under THIS request's own location-filtered key)
 * may re-carry it, a location-defaulted request never gets the
 * "default-browse" fallback (an UNFILTERED cached result) at all — claiming
 * a location over unfiltered results would lie about what's being shown —
 * and the zero-hit `unavailable` shape always may, since it never renders
 * any hits for a location chip to misrepresent.
 * `resolveDegradedServe`'s own `servedKey` contract is covered directly in
 * jobs-search-cache.test.ts; this file drives the real `searchJobs` seam
 * end-to-end (real cache, real gazetteer/corpus-checker, mocked Meili
 * transport) so the assembly in search.ts is what's actually exercised.
 */
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { clearSearchCacheForTests } from "../../src/lib/jobs/search-cache";
import type { CountryLookup } from "../../src/lib/geo/ip-country";

before(() => {
  process.env.MEILISEARCH_HOST = "https://meili.test";
  process.env.MEILISEARCH_SEARCH_KEY = "k";
});

beforeEach(() => {
  clearSearchCacheForTests();
});

function jsonResponse(status: number, body: unknown) {
  const text = JSON.stringify(body);
  const res = {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => JSON.parse(text),
    clone() {
      return res;
    },
  };
  return res;
}

/** Real Meili transport, faked: `/facet-search` always validates whatever
 *  value it's asked about (so the IP country default resolves against the
 *  REAL bundled gazetteer without needing a live corpus), and the main
 *  `/search` endpoint succeeds or throws depending on `state.searchFails` —
 *  flipped mid-test to seed the cache with a success, then simulate the
 *  outage that has to fall back to it. */
function installFetchMock(state: { searchFails: boolean }) {
  return async (url: string | URL, init?: RequestInit) => {
    const urlStr = String(url);
    if (urlStr.includes("/facet-search")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { facetQuery: string };
      return jsonResponse(200, { facetHits: [{ value: body.facetQuery, count: 1_000 }] });
    }
    if (urlStr.includes("/indexes/") && urlStr.includes("/search")) {
      if (state.searchFails) throw new Error("ECONNRESET");
      return jsonResponse(200, { hits: [], totalHits: 0 });
    }
    throw new Error(`unexpected fetch in test: ${urlStr}`);
  };
}

const CA_LOOKUP: CountryLookup = async () => "CA";

test("degraded serve, EXACT cache hit: the failed request's own cached response carries defaultedLocation", async (t) => {
  const state = { searchFails: false };
  t.mock.method(globalThis, "fetch", installFetchMock(state));
  const { searchJobs } = await import("../../src/lib/jobs/search");

  const raw = { facets: { work_type: ["remote"] } };
  const opts = { clientIp: "1.2.3.4", countryLookup: CA_LOOKUP };

  const first = await searchJobs(raw, opts);
  assert.equal(first.defaultedLocation, "CA", "sanity: the IP default actually fired");

  state.searchFails = true;
  const second = await searchJobs(raw, opts);
  assert.equal(second.meta?.degraded, true);
  assert.equal(second.meta?.servedFrom, "cache");
  assert.equal(second.defaultedLocation, "CA", "exact cache hit — safe to re-stamp the current request's default");
});

test("degraded serve, no exact hit: a filtered, location-defaulted request gets unavailable, never the default-browse rows", async (t) => {
  const state = { searchFails: false };
  t.mock.method(globalThis, "fetch", installFetchMock(state));
  const { searchJobs } = await import("../../src/lib/jobs/search");

  // Seed the default-browse fallback key with a plain, un-defaulted browse
  // (no opts — mirrors an MCP/non-browser caller, so the IP step no-ops and
  // this response really is unfiltered).
  const seed = await searchJobs({});
  assert.equal(seed.defaultedLocation, undefined, "sanity: nothing to default without clientIp/countryLookup");

  // A DIFFERENT request whose own exact key was never cached, and which DOES
  // resolve an IP default. The unfiltered rows are not its rows.
  state.searchFails = true;
  const opts = { clientIp: "1.2.3.4", countryLookup: CA_LOOKUP };
  const filtered = await searchJobs({ facets: { work_type: ["hybrid"] } }, opts);
  assert.equal(filtered.unavailable, true);
  assert.equal(filtered.hits.length, 0);
  assert.equal(filtered.meta, undefined, "not served from any cache");
  assert.equal(filtered.defaultedLocation, "CA", "the unavailable shape still describes how the request was read");

  // An empty browse the IP default scoped to Canada is not the unfiltered browse either.
  const defaultedBrowse = await searchJobs({}, opts);
  assert.equal(defaultedBrowse.unavailable, true);
  assert.equal(defaultedBrowse.defaultedLocation, "CA");

  // The plain default browse itself still gets its fallback.
  const plain = await searchJobs({});
  assert.equal(plain.meta?.degraded, true);
  assert.equal(plain.meta?.servedFrom, "cache");
  assert.equal(plain.total, seed.total, "served the cached default-browse body");
  assert.equal(plain.defaultedLocation, undefined);
});

test("backend throws with NO cache at all: the unavailable shape DOES carry defaultedLocation", async (t) => {
  const state = { searchFails: true };
  t.mock.method(globalThis, "fetch", installFetchMock(state));
  const { searchJobs } = await import("../../src/lib/jobs/search");

  const opts = { clientIp: "1.2.3.4", countryLookup: CA_LOOKUP };
  const result = await searchJobs({ facets: { work_type: ["onsite"] } }, opts);

  assert.equal(result.unavailable, true);
  assert.equal(result.hits.length, 0, "zero hits — nothing for a location chip to misrepresent");
  assert.equal(result.defaultedLocation, "CA", "describes how the REQUEST was interpreted, still true with the backend down");
});

test("success path still carries defaultedLocation (regression guard)", async (t) => {
  const state = { searchFails: false };
  t.mock.method(globalThis, "fetch", installFetchMock(state));
  const { searchJobs } = await import("../../src/lib/jobs/search");

  const opts = { clientIp: "1.2.3.4", countryLookup: CA_LOOKUP };
  const result = await searchJobs({ facets: { work_type: ["remote"] } }, opts);

  assert.equal(result.meta?.servedFrom, "live");
  assert.equal(result.defaultedLocation, "CA");
});

test("a request with its own location signal never has one invented, across success, degraded-exact, and unavailable", async (t) => {
  const state = { searchFails: false };
  t.mock.method(globalThis, "fetch", installFetchMock(state));
  const { searchJobs } = await import("../../src/lib/jobs/search");

  // `places` already resolved (a typed query or the MCP `location` param) —
  // `hasLocationSignal` short-circuits `applyLocationDefault` regardless of
  // the IP/countryLookup opts supplied.
  const raw = { places: [{ any: [{ field: "location_city" as const, value: "Toronto" }] }] };
  const opts = { clientIp: "1.2.3.4", countryLookup: CA_LOOKUP };

  const success = await searchJobs(raw, opts);
  assert.equal(success.defaultedLocation, undefined, "success: no invented default");

  state.searchFails = true;
  const degradedExact = await searchJobs(raw, opts);
  assert.equal(degradedExact.meta?.degraded, true);
  assert.equal(degradedExact.defaultedLocation, undefined, "degraded exact hit: no invented default");

  clearSearchCacheForTests();
  const unavailable = await searchJobs(raw, opts);
  assert.equal(unavailable.unavailable, true);
  assert.equal(unavailable.defaultedLocation, undefined, "unavailable: no invented default");
});

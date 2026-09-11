import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveLocationFacet, type CompanyProbe, type LocationVocabulary } from "../../src/lib/jobs/query-understanding";
import { buildFilter, LIVE_VACANCY_FILTER, REMOTE_ANYWHERE_CLAUSE } from "../../src/lib/jobs/meilisearch";
import { buildGazetteerIndex, type GazetteerData } from "../../src/lib/geo/gazetteer";
import { resolveLocationDefault, placesForCountry } from "../../src/lib/geo/ip-default";
import type { CountryLookup } from "../../src/lib/geo/ip-country";
import type { CorpusValueChecker } from "../../src/lib/geo/corpus-values";
import type { PlaceFilter } from "../../src/lib/jobs/types";

/**
 * Ruling (Vivek): a remote job with no geographic restriction must be
 * listed under ANY country filter. Data fact (live-verified): that set is
 * exactly `work_type = "remote" AND location_country IS NULL` in the Meili
 * `jobs` index (52,512 docs all-dates).
 *
 * Every test here goes through the REAL SERP path — `resolveLocationFacet`
 * (query-understanding.ts, the exact function `search.ts`'s `searchJobs`
 * calls) then `buildFilter` — not `buildFilter` called directly on a
 * hand-built `facets`/`places` object. Round 1 of this PR asserted against
 * `buildFilter({ facets: { location_country: [...] } })` directly, which
 * bypasses `resolveLocationFacet` entirely; `resolveLocationFacet` always
 * deletes `facets.location_country` and moves it into `p.places` before
 * `buildFilter` ever sees it (see query-understanding.ts:531-538), so that
 * shape never occurs on `/jobs` and the round-1 tests proved nothing about
 * the real page. Same fixture-gazetteer/fake-corpus-checker shape
 * `tests/unit/jobs-place-parsing.test.ts` uses for the rest of this layer.
 */

const DATA: GazetteerData = {
  countries: [
    ["CA", "CAN", "Canada"],
    ["DE", "DEU", "Germany"],
    ["GB", "GBR", "United Kingdom"],
  ],
  admin1: [["CA", "ON", "Ontario"]],
  cities: [["Toronto", null, 43.70011, -79.4163, "CA", "ON", 2794356]],
};
const GAZETTEER = buildGazetteerIndex(DATA);

const NEVER_CORROBORATES: CompanyProbe = async () => false;

/** Country-blind allowlist, same shape as jobs-place-parsing.test.ts's
 *  `fakeVocab` — every value below actually "exists" in this fake corpus;
 *  everything else (CA/DE/GB's ISO codes, any subdivision candidate) does
 *  not, so a resolved gazetteer candidate still has to clear this before
 *  becoming a filter. */
function fakeVocab(realValues: PlaceFilter[]): LocationVocabulary {
  const checker: CorpusValueChecker = async (groups) =>
    groups.map((candidates) => {
      const seen = new Set<string>();
      const out: PlaceFilter[] = [];
      for (const c of candidates) {
        const hit = realValues.find((v) => v.field === c.field && v.value.toLowerCase() === c.value.toLowerCase());
        if (!hit) continue;
        const key = `${hit.field} ${hit.value}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push(hit);
        }
      }
      return out;
    });
  return { gazetteer: GAZETTEER, corpusChecker: checker, companyProbe: NEVER_CORROBORATES };
}

const VOCAB = fakeVocab([
  { field: "location_country", value: "Canada" },
  { field: "location_country", value: "Germany" },
  { field: "location_country", value: "United Kingdom" },
  { field: "location_city", value: "Toronto" },
  { field: "location_state", value: "Ontario" },
]);

test("(a) typed 'Canada' widens the place clause to admit remote-anywhere jobs; posted/ghost clauses are untouched", async () => {
  const p = await resolveLocationFacet(
    { facets: { location_country: ["Canada"] }, postedBucket: "30d", hideGhosts: true },
    VOCAB,
  );
  const filter = buildFilter(p);
  const placeClause = filter.find((f) => f.includes("location_country"));
  assert.equal(placeClause, `((location_country = "Canada" OR (${REMOTE_ANYWHERE_CLAUSE})))`);
  assert.equal(filter[0], LIVE_VACANCY_FILTER);
  assert.ok(filter.includes('ghost_badge != "likely_ghost"'), `expected the ghost clause untouched: ${JSON.stringify(filter)}`);
  assert.ok(filter.some((f) => f.startsWith("posted_ts >=")), `expected the posted clause untouched: ${JSON.stringify(filter)}`);
});

test("(b) the widening is class-wide, not a Canada special case — Germany and United Kingdom get it too", async () => {
  for (const [country] of [["Germany"], ["United Kingdom"]]) {
    const p = await resolveLocationFacet({ facets: { location_country: [country] } }, VOCAB);
    const filter = buildFilter(p);
    const placeClause = filter.find((f) => f.includes("location_country"));
    assert.equal(placeClause, `((location_country = "${country}" OR (${REMOTE_ANYWHERE_CLAUSE})))`, `expected ${country} widened`);
  }
});

test("(c) a city or a state is NOT widened — mirrors expansion test (d): the widening is wired only into country resolution", async () => {
  for (const value of ["Toronto", "Ontario"]) {
    const p = await resolveLocationFacet({ facets: { location_country: [value] } }, VOCAB);
    const filter = buildFilter(p);
    const placeClause = filter.find((f) => f.includes("location_city") || f.includes("location_state"));
    assert.ok(placeClause, `expected a place clause for ${value}: ${JSON.stringify(filter)}`);
    assert.ok(!placeClause!.includes("remote"), `${value} must not be widened: ${placeClause}`);
  }
});

test("(d) typed 'onsite canada' — widened place group AND the onsite work-type, full string", async () => {
  const p = await resolveLocationFacet({ facets: { location_country: ["onsite canada"] } }, VOCAB);
  const filter = buildFilter(p);
  const placeClause = filter.find((f) => f.includes("location_country"));
  assert.equal(
    placeClause,
    `(((location_country = "Canada" OR (${REMOTE_ANYWHERE_CLAUSE})) AND (work_type = "onsite")))`,
  );
});

test("(e) a global work_type facet excludes remote-anywhere docs from a widened country filter — algebra, not a guard", async () => {
  const p = await resolveLocationFacet({ facets: { location_country: ["Canada"], work_type: ["hybrid"] } }, VOCAB);
  const filter = buildFilter(p);
  const placeClause = filter.find((f) => f.includes("location_country"));
  assert.equal(placeClause, `((location_country = "Canada" OR (${REMOTE_ANYWHERE_CLAUSE})))`);
  // The place clause and this top-level facet clause are separate array
  // entries — buildFilter ANDs across the whole array. A remote-anywhere
  // doc has work_type = "remote", so `(work_type = "hybrid")` excludes it
  // by construction; renderPlaceClause/buildFilter need no explicit
  // work_type guard to make that true.
  assert.ok(filter.includes('(work_type = "hybrid")'), `expected a top-level work_type clause: ${JSON.stringify(filter)}`);
});

/**
 * Round 2 of #479 set `remoteAnywhere` only inside `parsePlaceTokens`,
 * missing the other two builders of a country `PlaceClause`:
 * `resolveLocationDefault` (geo/ip-default.ts, every IP-geolocated search)
 * and `placesForCountry` (geo/ip-default.ts, the cached cold-visit /jobs
 * front door). Round 3 gives all three exactly one factory,
 * `placeClause` (geo/resolve-place.ts) — (g)-(i) below cover the two
 * builders round 2 missed, through their REAL callers, not by asserting on
 * the shared factory directly (a factory that's right in isolation and
 * wrong at one of its call sites is exactly what round 2 shipped).
 */
const PASSTHROUGH_CORPUS_CHECKER: CorpusValueChecker = async (groups) => groups;

/** Shared by (g)/(h): resolveLocationDefault's country clause must widen to
 *  admit remote-anywhere jobs exactly like a typed country facet does. */
async function assertIpDefaultWidensRemoteAnywhere(iso2: string) {
  const lookup: CountryLookup = async () => iso2;
  const result = await resolveLocationDefault("1.2.3.4", GAZETTEER, PASSTHROUGH_CORPUS_CHECKER, lookup);
  assert.ok(result, `expected resolveLocationDefault to resolve ${iso2}`);
  assert.equal(result!.places[0].remoteAnywhere, true, `resolveLocationDefault(${iso2}) must set remoteAnywhere`);
  const filter = buildFilter({ places: result!.places });
  const placeFilterClause = filter.find((f) => f.includes("location_country"));
  assert.ok(
    placeFilterClause?.includes(`OR (${REMOTE_ANYWHERE_CLAUSE})`),
    `expected the IP-default clause widened for ${iso2}: ${placeFilterClause}`,
  );
}

test("(g) resolveLocationDefault('CA') funnels through the shared factory — round 2's other bypassed builder", async () => {
  await assertIpDefaultWidensRemoteAnywhere("CA");
});

test("(h) the widening is class-wide for the IP default too, same as (b) is for typed search — Germany, not just Canada", async () => {
  await assertIpDefaultWidensRemoteAnywhere("DE");
});

test("(i) placesForCountry — flagged for a real country, undefined (unchanged) for one the gazetteer doesn't recognize", () => {
  const flagged = placesForCountry("CA", GAZETTEER);
  assert.ok(flagged?.length, "expected placesForCountry('CA') to produce a clause");
  assert.equal(flagged![0].remoteAnywhere, true, "placesForCountry — the third bypassed builder — must set remoteAnywhere");
  assert.equal(placesForCountry("ZZ", GAZETTEER), undefined, "an ISO2 the gazetteer doesn't recognize must still fail open");
});

test("(j) guard: all three country-clause builders render the IDENTICAL place clause — a fourth builder that diverges fails this", async () => {
  const vocabPassthrough: LocationVocabulary = {
    gazetteer: GAZETTEER,
    corpusChecker: PASSTHROUGH_CORPUS_CHECKER,
    companyProbe: NEVER_CORROBORATES,
  };

  const typed = await resolveLocationFacet({ facets: { location_country: ["Canada"] } }, vocabPassthrough);
  const typedClause = buildFilter(typed).find((f) => f.includes("location_country"));

  const ipDefault = await resolveLocationDefault("1.2.3.4", GAZETTEER, PASSTHROUGH_CORPUS_CHECKER, async () => "CA");
  const ipDefaultClause = buildFilter({ places: ipDefault!.places }).find((f) => f.includes("location_country"));

  const coldVisit = placesForCountry("CA", GAZETTEER);
  const coldVisitClause = buildFilter({ places: coldVisit }).find((f) => f.includes("location_country"));

  assert.ok(
    typedClause === ipDefaultClause && ipDefaultClause === coldVisitClause,
    `the three country-clause builders diverged: typed=${typedClause} ipDefault=${ipDefaultClause} coldVisit=${coldVisitClause}`,
  );
});

test("(f) the count route runs the same query-understanding step, in the same relative order, as /jobs — regression guard", () => {
  const routeSrc = readFileSync(new URL("../../src/app/api/jobs/count/route.ts", import.meta.url), "utf8");
  const understoodIdx = routeSrc.indexOf("understandSearchParams(");
  const intentIdx = routeSrc.indexOf("resolveCompanyIntentResult(");
  assert.ok(understoodIdx >= 0, "the count route must call understandSearchParams (src/lib/jobs/search.ts) — the same function searchJobs calls — or it silently diverges from /jobs on every location-filtered query");
  assert.ok(intentIdx >= 0, "expected the route to still resolve company intent");
  assert.ok(
    understoodIdx < intentIdx,
    "understandSearchParams must run BEFORE company-intent resolution, mirroring search.ts's searchJobs (searchMeili resolves company intent off the ALREADY-understood params) — reordering it after would probe company intent against raw, pre-understanding query text",
  );
});

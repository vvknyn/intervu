import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveLocationFacet, type CompanyProbe, type LocationVocabulary } from "../../src/lib/jobs/query-understanding";
import { buildFilter, LIVE_VACANCY_FILTER, REMOTE_ANYWHERE_CLAUSE } from "../../src/lib/jobs/meilisearch";
import { buildGazetteerIndex, type GazetteerData } from "../../src/lib/geo/gazetteer";
import { applyLocationDefault, resolveLocationDefault, placesForCountry } from "../../src/lib/geo/ip-default";
import type { CountryLookup } from "../../src/lib/geo/ip-country";
import type { CorpusValueChecker } from "../../src/lib/geo/corpus-values";
import type { PlaceFilter } from "../../src/lib/jobs/types";

/**
 * Untagged remote roles (`work_type = "remote" AND location_country IS NULL`)
 * belong in the IP geo default only — the chip reads "United States · Remote".
 * An explicit country pick (`?country=Canada`) must NOT OR them in: header
 * count, facet distribution, and Past 24h results must agree on Canada-only.
 *
 * Every test here goes through the REAL SERP path — `resolveLocationFacet`
 * then `buildFilter` — plus the IP-default builders that still widen.
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
  { field: "location_country", value: "Worldwide" },
  { field: "location_country", value: "Czechia" },
  { field: "location_city", value: "Nullville" },
]);

test("(a) typed 'Canada' does NOT widen to remote-anywhere; posted/ghost clauses are untouched", async () => {
  const p = await resolveLocationFacet(
    { facets: { location_country: ["Canada"] }, postedBucket: "30d", hideGhosts: true },
    VOCAB,
  );
  assert.equal(p.places![0].remoteAnywhere, undefined);
  const filter = buildFilter(p);
  const placeClause = filter.find((f) => f.includes("location_country"));
  assert.equal(placeClause, `((location_country = "Canada"))`);
  assert.ok(!placeClause!.includes("remote"), placeClause);
  assert.equal(filter[0], LIVE_VACANCY_FILTER);
  assert.ok(filter.includes('ghost_badge != "likely_ghost"'), `expected the ghost clause untouched: ${JSON.stringify(filter)}`);
  assert.ok(filter.some((f) => f.startsWith("posted_ts >=")), `expected the posted clause untouched: ${JSON.stringify(filter)}`);
});

test("(b) explicit country is class-wide — Germany and United Kingdom are NOT widened either", async () => {
  for (const country of ["Germany", "United Kingdom"]) {
    const p = await resolveLocationFacet({ facets: { location_country: [country] } }, VOCAB);
    assert.equal(p.places![0].remoteAnywhere, undefined);
    const filter = buildFilter(p);
    const placeClause = filter.find((f) => f.includes("location_country"));
    assert.equal(placeClause, `((location_country = "${country}"))`, `expected ${country} without widening`);
    assert.ok(!placeClause!.includes(REMOTE_ANYWHERE_CLAUSE), placeClause);
  }
});

test("(c) a city or a state is NOT widened — mirrors expansion test (d): the widening is wired only into IP default", async () => {
  for (const value of ["Toronto", "Ontario"]) {
    const p = await resolveLocationFacet({ facets: { location_country: [value] } }, VOCAB);
    const filter = buildFilter(p);
    const placeClause = filter.find((f) => f.includes("location_city") || f.includes("location_state"));
    assert.ok(placeClause, `expected a place clause for ${value}: ${JSON.stringify(filter)}`);
    assert.ok(!placeClause!.includes("remote"), `${value} must not be widened: ${placeClause}`);
  }
});

test("(d) typed 'onsite canada' — Canada place AND onsite work-type, no remote-anywhere OR", async () => {
  const p = await resolveLocationFacet({ facets: { location_country: ["onsite canada"] } }, VOCAB);
  assert.equal(p.places![0].remoteAnywhere, undefined);
  const filter = buildFilter(p);
  const placeClause = filter.find((f) => f.includes("location_country"));
  assert.equal(placeClause, `(((location_country = "Canada") AND (work_type = "onsite")))`);
  assert.ok(!placeClause!.includes(REMOTE_ANYWHERE_CLAUSE), placeClause);
});

test("(e) a global work_type facet on an explicit country search still ANDs at the top level", async () => {
  const p = await resolveLocationFacet({ facets: { location_country: ["Canada"], work_type: ["hybrid"] } }, VOCAB);
  const filter = buildFilter(p);
  const placeClause = filter.find((f) => f.includes("location_country"));
  assert.equal(placeClause, `((location_country = "Canada"))`);
  assert.ok(filter.includes('(work_type = "hybrid")'), `expected a top-level work_type clause: ${JSON.stringify(filter)}`);
});

const PASSTHROUGH_CORPUS_CHECKER: CorpusValueChecker = async (groups) => groups;

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

test("(g) resolveLocationDefault('CA') still widens — IP default honesty", async () => {
  await assertIpDefaultWidensRemoteAnywhere("CA");
});

test("(h) the widening is class-wide for the IP default too — Germany, not just Canada", async () => {
  await assertIpDefaultWidensRemoteAnywhere("DE");
});

test("(i) placesForCountry — still flagged for a real country, undefined for an unknown ISO2", () => {
  const flagged = placesForCountry("CA", GAZETTEER);
  assert.ok(flagged?.length, "expected placesForCountry('CA') to produce a clause");
  assert.equal(flagged![0].remoteAnywhere, true, "placesForCountry must set remoteAnywhere");
  assert.equal(placesForCountry("ZZ", GAZETTEER), undefined, "an ISO2 the gazetteer doesn't recognize must still fail open");
});

test("(j) explicit typed Canada and IP default DIVERGE — typed is narrow, default is widened", async () => {
  const vocabPassthrough: LocationVocabulary = {
    gazetteer: GAZETTEER,
    corpusChecker: PASSTHROUGH_CORPUS_CHECKER,
    companyProbe: NEVER_CORROBORATES,
  };

  const typed = await resolveLocationFacet({ facets: { location_country: ["Canada"] } }, vocabPassthrough);
  const typedClause = buildFilter(typed).find((f) => f.includes("location_country"));

  const ipDefault = await resolveLocationDefault("1.2.3.4", GAZETTEER, PASSTHROUGH_CORPUS_CHECKER, async () => "CA");
  const ipDefaultClause = buildFilter({ places: ipDefault!.places }).find((f) => f.includes("location_country"));

  const expandedCanada =
    `((location_country = "Canada" OR location_country = "CA" OR location_country = "CAN" OR location_country = "Canada" OR location_country = "Ontario" OR location_country = "Toronto"))`;
  assert.equal(typedClause, expandedCanada);
  assert.ok(!typedClause!.includes(REMOTE_ANYWHERE_CLAUSE), typedClause);
  assert.ok(ipDefaultClause?.includes(`OR (${REMOTE_ANYWHERE_CLAUSE})`), ipDefaultClause);
  assert.notEqual(typedClause, ipDefaultClause);
});

test("(k) a typed literal the gazetteer can't resolve but the corpus has as location_country is NOT widened", async () => {
  const p = await resolveLocationFacet({ facets: { location_country: ["worldwide"] } }, VOCAB);
  assert.equal(p.places![0].remoteAnywhere, undefined);
  const filter = buildFilter(p);
  const placeClause = filter.find((f) => f.includes("location_country"));
  assert.equal(placeClause, `((location_country = "Worldwide"))`);
});

test("(l) a second unresolvable country spelling is also NOT widened", async () => {
  const p = await resolveLocationFacet({ facets: { location_country: ["czechia"] } }, VOCAB);
  const filter = buildFilter(p);
  const placeClause = filter.find((f) => f.includes("location_country"));
  assert.equal(placeClause, `((location_country = "Czechia"))`);
  assert.ok(!placeClause!.includes(REMOTE_ANYWHERE_CLAUSE), placeClause);
});

test("(m) a literal that matches ONLY location_city is NOT widened", async () => {
  const p = await resolveLocationFacet({ facets: { location_country: ["nullville"] } }, VOCAB);
  const filter = buildFilter(p);
  const placeClause = filter.find((f) => f.includes("location_city"));
  assert.ok(placeClause, `expected a place clause for nullville: ${JSON.stringify(filter)}`);
  assert.ok(!placeClause!.includes("remote"), `a city-only literal must not be widened: ${placeClause}`);
});

test("(n) only IP-default builders widen — explicit typed/literal paths never do", async () => {
  const vocabPassthrough: LocationVocabulary = {
    gazetteer: GAZETTEER,
    corpusChecker: PASSTHROUGH_CORPUS_CHECKER,
    companyProbe: NEVER_CORROBORATES,
  };

  const typed = await resolveLocationFacet({ facets: { location_country: ["Canada"] } }, vocabPassthrough);
  const typedClause = buildFilter(typed).find((f) => f.includes("location_country"));

  const literal = await resolveLocationFacet({ facets: { location_country: ["worldwide"] } }, VOCAB);
  const literalClause = buildFilter(literal).find((f) => f.includes("location_country"));

  const ipDefault = await resolveLocationDefault("1.2.3.4", GAZETTEER, PASSTHROUGH_CORPUS_CHECKER, async () => "CA");
  const ipDefaultClause = buildFilter({ places: ipDefault!.places }).find((f) => f.includes("location_country"));

  const coldVisit = placesForCountry("CA", GAZETTEER);
  const coldVisitClause = buildFilter({ places: coldVisit }).find((f) => f.includes("location_country"));

  assert.ok(!typedClause?.includes(REMOTE_ANYWHERE_CLAUSE), typedClause);
  assert.ok(!literalClause?.includes(REMOTE_ANYWHERE_CLAUSE), literalClause);
  assert.ok(ipDefaultClause?.includes(REMOTE_ANYWHERE_CLAUSE), ipDefaultClause);
  assert.ok(coldVisitClause?.includes(REMOTE_ANYWHERE_CLAUSE), coldVisitClause);
});

test("(o) applyLocationDefault still widens for a bare browse with no location signal", async () => {
  const lookup: CountryLookup = async () => "CA";
  const result = await applyLocationDefault({ q: "engineer" }, "1.2.3.4", lookup, async () => ({
    gazetteer: GAZETTEER,
    corpusChecker: PASSTHROUGH_CORPUS_CHECKER,
  }));
  assert.equal(result.defaultedLocation, "CA");
  assert.equal(result.remoteAnywhere, true);
  assert.ok(
    buildFilter(result.params).some((f) => f.includes(REMOTE_ANYWHERE_CLAUSE)),
    JSON.stringify(buildFilter(result.params)),
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

import { test } from "node:test";
import assert from "node:assert/strict";
import { applyQueryUnderstanding, parsePlaceTokens, type LocationVocabulary } from "../../src/lib/jobs/query-understanding";
import { buildFilter } from "../../src/lib/jobs/meilisearch";
import { buildGazetteerIndex, type GazetteerData } from "../../src/lib/geo/gazetteer";
import type { CorpusValueChecker } from "../../src/lib/geo/corpus-values";
import type { PlaceFilter } from "../../src/lib/jobs/types";

/** Small fixture gazetteer — Toronto/Ontario/Canada plus a real gazetteer
 *  city ("Lisbon") the fixture CORPUS below never validates, so it proves
 *  the corpus-validation layer (not just gazetteer recognition) gates the
 *  final filter. "Richmond Hill" is a radius neighbor of Toronto AND the
 *  name of a real Georgia, US city — the cross-country homonym bug fixture. */
const DATA: GazetteerData = {
  countries: [
    ["CA", "CAN", "Canada"],
    ["US", "USA", "United States"],
  ],
  admin1: [["CA", "ON", "Ontario"]],
  cities: [
    ["Toronto", null, 43.70011, -79.4163, "CA", "ON", 2794356],
    ["Richmond Hill", null, 43.8828, -79.4403, "CA", "ON", 202022], // ~20km from Toronto — a radius neighbor
    ["New York", null, 40.7128, -74.006, "US", "NY", 8804190],
    ["Lisbon", null, 38.7223, -9.1393, "PT", null, 506654],
  ],
};
const GAZETTEER = buildGazetteerIndex(DATA);

/** Shaped like the live corpus (a small allowlist of real values) — every
 *  place below actually "exists"; everything else (Lisbon, radius
 *  neighbors the fixture gazetteer doesn't even define here) does not, so
 *  a resolved gazetteer candidate still has to clear this before becoming
 *  a filter. Deliberately country-BLIND per (field, value) — exactly how
 *  Meilisearch's facet-search really behaves: a "Richmond Hill" hit is one
 *  aggregate value regardless of how many different countries' postings
 *  contributed to it, which is exactly why the AND-scoping in
 *  query-understanding.ts (not this fake) is what has to keep them apart. */
function fakeVocab(realValues: PlaceFilter[], gazetteer = GAZETTEER): LocationVocabulary {
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
  return { gazetteer, corpusChecker: checker };
}

const VOCAB = fakeVocab([
  { field: "location_city", value: "Toronto" },
  { field: "location_city", value: "New York" },
  { field: "location_country", value: "Canada" },
]);

test("the screenshot case: 'Technical Account Manager canada' becomes a Canada FILTER, not a content word", async () => {
  const { residualQ, places } = await parsePlaceTokens("Technical Account Manager canada", VOCAB);
  assert.equal(residualQ, "Technical Account Manager");
  assert.deepEqual(places, [{ any: [{ field: "location_country", value: "Canada" }] }]);
});

test("multi-word places match longest-first and leave the rest of the query alone", async () => {
  const { residualQ, places } = await parsePlaceTokens("senior engineer new york", VOCAB);
  assert.equal(residualQ, "senior engineer");
  assert.equal(places.length, 1);
  assert.deepEqual(places[0].any, [{ field: "location_city", value: "New York" }]);
  assert.equal(places[0].scopedToCountry, undefined, "New York's country (US) never validated in this fake corpus");
});

test("several places OR together; punctuation between them is irrelevant", async () => {
  const { residualQ, places } = await parsePlaceTokens("Product Manager - Toronto, Canada", VOCAB);
  assert.equal(residualQ, "Product Manager");
  assert.equal(places.length, 2);
  const filter = buildFilter({ q: residualQ, places });
  assert.ok(
    filter.some((f) => f.includes('location_city = "Toronto"') && f.includes('location_country = "Canada"') && f.includes(" OR ")),
    `Toronto and Canada must be OR'd together as separately-typed mentions: ${JSON.stringify(filter)}`,
  );
});

test("a query that is only a place browses that place — empty residual, filter set", async () => {
  const { residualQ, places } = await parsePlaceTokens("toronto", VOCAB);
  assert.equal(residualQ, "");
  assert.equal(places.length, 1);
});

test("cross-country homonym FIX: Toronto's 'Richmond Hill' radius match is scoped to Canada, so a same-named US row can never satisfy the filter", async () => {
  const vocab = fakeVocab([
    { field: "location_city", value: "Toronto" },
    { field: "location_city", value: "Richmond Hill" }, // aggregate hit — could be CA or US postings, facet-search can't tell
    { field: "location_country", value: "Canada" },
  ]);
  const { places } = await parsePlaceTokens("toronto", vocab);
  assert.equal(places.length, 1);
  const [clause] = places;
  assert.ok(
    clause.any.some((f) => f.field === "location_city" && f.value === "Richmond Hill"),
    `expected Richmond Hill in the city OR-set: ${JSON.stringify(clause)}`,
  );
  assert.ok(clause.scopedToCountry?.length, "must carry a country scope");
  assert.ok(clause.scopedToCountry!.some((f) => f.value === "Canada"));

  const filter = buildFilter({ q: "", places });
  const placeClause = filter.find((f) => f.includes("Richmond Hill"))!;
  assert.ok(placeClause, `expected a filter clause mentioning Richmond Hill: ${JSON.stringify(filter)}`);
  assert.match(
    placeClause,
    /\(.*location_city = "Richmond Hill".*\) AND \(.*location_country = "Canada".*\)/,
    `the city OR-group must be AND'd against the country OR-group, not left as a bare city match: ${placeClause}`,
  );
});

test("a real gazetteer place the corpus has no postings for produces no filter — and stays OUT of the query text, not back in as a content word (full-text matching on a bare place name is exactly what place filtering exists to avoid — see the module doc)", async () => {
  const { residualQ, places } = await parsePlaceTokens("product manager lisbon", VOCAB);
  assert.equal(residualQ, "product manager");
  assert.deepEqual(places, []);
});

test("a word the gazetteer has never heard of (not a recognized place at all) DOES survive as content", async () => {
  const { residualQ, places } = await parsePlaceTokens("product manager zzznotaplace", VOCAB);
  assert.equal(residualQ, "product manager zzznotaplace");
  assert.deepEqual(places, []);
});

test("applyQueryUnderstanding composes: work mode first, then places", async () => {
  const p = await applyQueryUnderstanding({ q: "remote react developer toronto" }, VOCAB);
  assert.deepEqual(p.facets?.work_type, ["remote"]);
  assert.equal(p.q, "react developer");
  assert.equal(p.places?.length, 1);
  assert.deepEqual(p.places![0].any, [{ field: "location_city", value: "Toronto" }]);
});

test("an explicit country facet from the panel wins — typed place tokens stay in the query", async () => {
  const p = await applyQueryUnderstanding(
    { q: "product manager canada", facets: { location_country: ["United States"] } },
    VOCAB,
  );
  assert.equal(p.q, "product manager canada");
  assert.equal(p.places, undefined);
});

test("no vocabulary means no place parsing — never a crash, never a guess", async () => {
  const p = await applyQueryUnderstanding({ q: "product manager canada" });
  assert.equal(p.q, "product manager canada");
  assert.equal(p.places, undefined);
});

/* ------------ common-word guard: the "success" hijack, and its class ------------
 * Live bug: "customer success manager" with no location filter returned 19
 * results, all in Perth, Australia — "success" is a real Perth, WA suburb,
 * and the corpus-count floor (PLACE_MIN_COUNT) doesn't help because Success
 * has real matching docs and clears it easily (see GUARD_VOCAB below, which
 * validates every candidate unconditionally — worst case for the floor).
 * Only a guard upstream of the corpus check — resolvePlacePhrase's
 * `guardCommonWords`, threaded here as `applyQueryUnderstanding`'s free-text
 * path — closes this class.
 *
 * A DEDICATED gazetteer/vocab (not the shared GAZETTEER/VOCAB above): adding
 * "Engineer", "Mobile" etc. as real cities to the shared fixture would leak
 * into every OTHER test in this file that resolves without the guard flag
 * (e.g. "senior engineer new york" a few tests up) — the exact cross-test
 * version of the bug this guard fixes for production. */
const GUARD_DATA: GazetteerData = {
  countries: [
    ["AU", "AUS", "Australia"],
    ["US", "USA", "United States"],
    ["KE", "KEN", "Kenya"],
  ],
  admin1: [],
  cities: [
    ["Perth", null, -31.9505, 115.8605, "AU", null, 2059484],
    ["Success", null, -32.1058, 115.8492, "AU", null, 12000], // real Perth, WA suburb, ~17km out
    ["Mobile", null, 30.6944, -88.0431, "US", null, 187041], // real Mobile, Alabama
    ["Engineer", null, -0.05, 37.6667, "KE", null, 5324], // real Engineer, Kenya (see geo-corpus-validation.test.ts)
  ],
};
const GUARD_GAZETTEER = buildGazetteerIndex(GUARD_DATA);
const GUARD_VOCAB = fakeVocab(
  [
    { field: "location_city", value: "Perth" },
    { field: "location_city", value: "Success" },
    { field: "location_city", value: "Mobile" },
    { field: "location_city", value: "Engineer" },
  ],
  GUARD_GAZETTEER,
);

test("the live bug: 'customer success manager' free text never treats \"success\" as a place — all three role words survive", async () => {
  const p = await applyQueryUnderstanding({ q: "customer success manager" }, GUARD_VOCAB);
  assert.equal(p.q, "customer success manager");
  assert.equal(p.places, undefined);
});

test("'mobile developer': 'mobile' (a real Mobile, Alabama) is not extracted as a place from free text", async () => {
  const p = await applyQueryUnderstanding({ q: "mobile developer" }, GUARD_VOCAB);
  assert.equal(p.q, "mobile developer");
  assert.equal(p.places, undefined);
});

test("bare 'engineer' (a real Engineer, Kenya) is not extracted as a place from free text", async () => {
  const p = await applyQueryUnderstanding({ q: "engineer" }, GUARD_VOCAB);
  assert.equal(p.q, "engineer");
  assert.equal(p.places, undefined);
});

test("'head of customer success': no place extracted, full residual survives", async () => {
  const p = await applyQueryUnderstanding({ q: "head of customer success" }, GUARD_VOCAB);
  assert.equal(p.q, "head of customer success");
  assert.equal(p.places, undefined);
});

test("control: 'barista toronto' still extracts Toronto — the guard doesn't touch real place words", async () => {
  const p = await applyQueryUnderstanding({ q: "barista toronto" }, VOCAB);
  assert.equal(p.q, "barista");
  assert.equal(p.places?.length, 1);
  assert.deepEqual(p.places![0].any, [{ field: "location_city", value: "Toronto" }]);
});

test("control: 'nurse perth' still extracts Perth — Perth isn't an English common word", async () => {
  const p = await applyQueryUnderstanding({ q: "nurse perth" }, GUARD_VOCAB);
  assert.equal(p.q, "nurse");
  assert.equal(p.places?.length, 1);
  assert.ok(
    p.places![0].any.some((f) => f.field === "location_city" && f.value === "Perth"),
    `expected Perth in the resolved place: ${JSON.stringify(p.places)}`,
  );
});

test("control: 'new york analyst' still extracts New York — multi-word candidates are exempt from the guard", async () => {
  const p = await applyQueryUnderstanding({ q: "new york analyst" }, VOCAB);
  assert.equal(p.q, "analyst");
  assert.equal(p.places?.length, 1);
  assert.deepEqual(p.places![0].any, [{ field: "location_city", value: "New York" }]);
});

test("explicit location intent bypasses the guard entirely: resolving \"success\" through parsePlaceTokens without the free-text flag (exactly how resolvePlaces/agent/tools.ts calls it for the MCP `location` param) still returns the place", async () => {
  const { residualQ, places } = await parsePlaceTokens("success", GUARD_VOCAB); // no 3rd arg — same call shape as resolvePlaces()
  assert.equal(residualQ, "");
  assert.equal(places.length, 1);
  assert.ok(
    places[0].any.some((f) => f.field === "location_city" && f.value === "Success"),
    `expected Success in the resolved place: ${JSON.stringify(places)}`,
  );
});

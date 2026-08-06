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
 *  final filter. */
const DATA: GazetteerData = {
  countries: [["CA", "CAN", "Canada"]],
  admin1: [["CA", "ON", "Ontario"]],
  cities: [
    ["Toronto", null, 43.70011, -79.4163, "CA", "ON", 2794356],
    ["New York", null, 40.7128, -74.006, "US", "NY", 8804190],
    ["Lisbon", null, 38.7223, -9.1393, "PT", null, 506654],
  ],
};
const GAZETTEER = buildGazetteerIndex(DATA);

/** Shaped like the live corpus (a small allowlist of real values) — every
 *  place below actually "exists"; everything else (Lisbon, radius
 *  neighbors the fixture gazetteer doesn't even define here) does not, so
 *  a resolved gazetteer candidate still has to clear this before becoming
 *  a filter. */
function fakeVocab(realValues: PlaceFilter[]): LocationVocabulary {
  const checker: CorpusValueChecker = async (candidates) => {
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
  };
  return { gazetteer: GAZETTEER, corpusChecker: checker };
}

const VOCAB = fakeVocab([
  { field: "location_city", value: "Toronto" },
  { field: "location_city", value: "New York" },
  { field: "location_country", value: "Canada" },
]);

test("the screenshot case: 'Technical Account Manager canada' becomes a Canada FILTER, not a content word", async () => {
  const { residualQ, places } = await parsePlaceTokens("Technical Account Manager canada", VOCAB);
  assert.equal(residualQ, "Technical Account Manager");
  assert.deepEqual(places, [{ field: "location_country", value: "Canada" }]);
});

test("multi-word places match longest-first and leave the rest of the query alone", async () => {
  const { residualQ, places } = await parsePlaceTokens("senior engineer new york", VOCAB);
  assert.equal(residualQ, "senior engineer");
  assert.deepEqual(places, [{ field: "location_city", value: "New York" }]);
});

test("several places OR together; punctuation between them is irrelevant", async () => {
  const { residualQ, places } = await parsePlaceTokens("Product Manager - Toronto, Canada", VOCAB);
  assert.equal(residualQ, "Product Manager");
  assert.deepEqual(
    [...places].sort((a, b) => a.field.localeCompare(b.field)),
    [
      { field: "location_city", value: "Toronto" },
      { field: "location_country", value: "Canada" },
    ],
  );
  const filter = buildFilter({ q: residualQ, places });
  assert.ok(
    filter.includes('(location_city = "Toronto" OR location_country = "Canada")'),
    `places must be ONE OR group: ${JSON.stringify(filter)}`,
  );
});

test("a query that is only a place browses that place — empty residual, filter set", async () => {
  const { residualQ, places } = await parsePlaceTokens("toronto", VOCAB);
  assert.equal(residualQ, "");
  assert.equal(places.length, 1);
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
  assert.deepEqual(p.places, [{ field: "location_city", value: "Toronto" }]);
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

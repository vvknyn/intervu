import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGazetteerIndex, type GazetteerData } from "../../src/lib/geo/gazetteer";
import { citySpellings } from "../../src/lib/geo/resolve-place";
import type { CorpusValueChecker } from "../../src/lib/geo/corpus-values";
import { resolveLocationFacet, type LocationVocabulary } from "../../src/lib/jobs/query-understanding";
import { buildFilter } from "../../src/lib/jobs/meilisearch";
import type { PlaceFilter } from "../../src/lib/jobs/types";

const GAZETTEER = buildGazetteerIndex({
  countries: [["IN", "IND", "India"], ["CA", "CAN", "Canada"]],
  admin1: [["IN", "19", "Karnataka"], ["IN", "16", "Maharashtra"], ["IN", "10", "Haryana"], ["CA", "ON", "Ontario"]],
  cities: [
    ["Bengaluru", null, 12.9716, 77.5946, "IN", "19", 8443675],
    ["Mumbai", null, 19.0760, 72.8777, "IN", "16", 12691836],
    ["Gurugram", null, 28.4595, 77.0266, "IN", "10", 876969],
    ["Toronto", null, 43.7001, -79.4163, "CA", "ON", 2794356],
  ],
} satisfies GazetteerData);

/** Corpus whose rows are split across the old and new spellings, as production's are. */
const CORPUS: PlaceFilter[] = ["Bangalore", "Bengaluru", "Bombay", "Mumbai", "Gurgaon", "Gurugram", "Toronto"].map((value) => ({
  field: "location_city",
  value,
}));

function vocab(): LocationVocabulary {
  const corpusChecker: CorpusValueChecker = async (groups) =>
    groups.map((candidates) =>
      CORPUS.filter((row) => candidates.some((c) => c.field === row.field && c.value.toLowerCase() === row.value.toLowerCase())),
    );
  return { gazetteer: GAZETTEER, corpusChecker, companyProbe: async () => false };
}

const PAIRS: [string, string][] = [
  ["Bangalore", "Bengaluru"],
  ["Bombay", "Mumbai"],
  ["Gurgaon", "Gurugram"],
];

for (const [oldName, newName] of PAIRS) {
  test(`citySpellings: ${oldName} and ${newName} each reach both spellings, the given one first`, () => {
    assert.deepEqual(citySpellings(oldName, GAZETTEER).map((s) => s.toLowerCase()).sort(), [oldName, newName].map((s) => s.toLowerCase()).sort());
    assert.equal(citySpellings(oldName, GAZETTEER)[0], oldName);
    assert.equal(citySpellings(newName, GAZETTEER)[0], newName);
    assert.equal(citySpellings(newName, GAZETTEER).length, 2);
  });

  test(`a picked city=${oldName} filters on ${oldName} OR ${newName} (manual and pack share resolveLocationFacet)`, async () => {
    const p = await resolveLocationFacet({ facets: { location_city: [oldName] } }, vocab());
    const filter = buildFilter(p).join(" ");
    assert.ok(filter.includes(`location_city = "${oldName}"`), filter);
    assert.ok(filter.includes(`location_city = "${newName}"`), filter);
  });
}

test("a city with no recorded variants stays a single literal", async () => {
  assert.deepEqual(citySpellings("Toronto", GAZETTEER), ["Toronto"]);
  const p = await resolveLocationFacet({ facets: { location_city: ["Toronto"] } }, vocab());
  const filter = buildFilter(p).join(" ");
  assert.ok(filter.includes('location_city = "Toronto"'));
  assert.equal((filter.match(/location_city =/g) ?? []).length, 1, filter);
});

test("a variant the corpus does not hold is not invented into the filter", async () => {
  const onlyNew: LocationVocabulary = {
    ...vocab(),
    corpusChecker: async (groups) => groups.map((c) => c.filter((x) => x.value.toLowerCase() === "mumbai").map((x) => ({ field: x.field, value: "Mumbai" }))),
  };
  const p = await resolveLocationFacet({ facets: { location_city: ["Bombay"] } }, onlyNew);
  const filter = buildFilter(p).join(" ");
  assert.ok(filter.includes('location_city = "Mumbai"'), filter);
  assert.ok(!filter.includes("Bombay"), filter);
});

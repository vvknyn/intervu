import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGazetteerIndex, loadGazetteer, type GazetteerData } from "../../src/lib/geo/gazetteer";
import { countryPlaceCandidates, resolvePlacePhrase } from "../../src/lib/geo/resolve-place";
import { buildFilter } from "../../src/lib/jobs/meilisearch";
import type { JobSearchParams, PlaceFilter } from "../../src/lib/jobs/types";

/**
 * The defect: `location_country` in the corpus holds unnormalized place
 * strings, not just countries — "Canada" (2,294 q="product manager" 30d
 * live) sits beside "Ontario" (566), "Toronto" (178), "British Columbia"
 * (106), invisible to a bare `location_country = "Canada"` filter. Same
 * class for the UK ("London" 670 outside "United Kingdom" 2,505). Fix:
 * `countryCandidates` (resolve-place.ts) now also proposes each expansion
 * country's admin1 regions and top cities as `location_country` candidates
 * — see country-subdivisions.ts for the pure decision logic under test here
 * (via its two exported entry points, `countryPlaceCandidates` and
 * `resolvePlacePhrase`, exactly like tests/unit/jobs-place-parsing.test.ts
 * exercises the rest of the geo-resolution layer).
 */

function has(candidates: { field: string; value: string }[], field: string, value: string): boolean {
  return candidates.some((c) => c.field === field && c.value === value);
}

test("(a) Canada expansion includes Ontario and Toronto as location_country candidates", () => {
  const candidates = countryPlaceCandidates("CA", loadGazetteer());
  assert.ok(candidates);
  assert.ok(has(candidates!, "location_country", "Ontario"), "expected Ontario in Canada's expansion");
  assert.ok(has(candidates!, "location_country", "Toronto"), "expected Toronto in Canada's expansion");
});

test("(b) UK expansion includes London as a location_country candidate", () => {
  const candidates = countryPlaceCandidates("GB", loadGazetteer());
  assert.ok(candidates);
  assert.ok(has(candidates!, "location_country", "London"), "expected London in the UK's expansion");
});

/** A country deliberately NOT in SUBDIVISION_EXPANSION_COUNTRIES, with its
 *  own admin1/city rows — proves subdivisionCandidates contributes zero
 *  rather than the fixture simply lacking data to expand. */
const NON_EXPANDED_DATA: GazetteerData = {
  countries: [["FR", "FRA", "France"]],
  admin1: [["FR", "IDF", "Ile-de-France"]],
  cities: [["Paris", null, 48.8566, 2.3522, "FR", "IDF", 2140526]],
};
const NON_EXPANDED_GAZETTEER = buildGazetteerIndex(NON_EXPANDED_DATA);

test("(c) a country with no dataset entry falls back to bare equality unchanged — subdivisionCandidates contributes zero", () => {
  const candidates = countryPlaceCandidates("FR", NON_EXPANDED_GAZETTEER);
  assert.ok(candidates);
  assert.deepEqual(
    candidates,
    [
      { field: "location_country", value: "France" },
      { field: "location_country", value: "FR" },
      { field: "location_country", value: "FRA" },
      { field: "location_country", value: "France", matchMode: "prefix" },
    ],
    "France (not in SUBDIVISION_EXPANSION_COUNTRIES) must resolve to exactly the original 4 base candidates",
  );
});

test("(d) a non-country place (an admin1/state selection) is not expanded — the widening is wired only into country resolution", () => {
  const r = resolvePlacePhrase("ontario", loadGazetteer());
  assert.ok(r, "'ontario' must resolve");
  assert.equal(r!.entity.type, "admin1");
  assert.ok(r!.candidates.length > 0);
  assert.ok(
    r!.candidates.every((c) => c.field === "location_state"),
    `an admin1 resolution's candidates must all be location_state — no location_country values present: ${JSON.stringify(r!.candidates)}`,
  );
  assert.ok(r!.candidates.some((c) => c.value === "Ontario"), "Ontario's own name must be a candidate");
});

test("(e) a subdivision candidate renders as a valid, properly OR'd and double-quoted Meili filter clause", () => {
  const places: JobSearchParams["places"] = [
    {
      any: [
        { field: "location_country", value: "Ontario" },
        { field: "location_country", value: "Canada" },
      ] as PlaceFilter[],
    },
  ];
  const filter = buildFilter({ places });
  assert.ok(
    filter.some(
      (f) => f.includes('location_country = "Ontario"') && f.includes('location_country = "Canada"') && f.includes(" OR "),
    ),
    `expected an OR'd, double-quoted clause for Ontario/Canada: ${JSON.stringify(filter)}`,
  );
});

/* ------------------------- ambiguity regressions -------------------------
 * The class-wide proof, not just the Canada/UK instances that motivated the
 * change: a bare `location_country = "Georgia"` OR-term would also match
 * real Georgia-the-country postings; a bare "Victoria" term would also match
 * Australia's Victoria state postings. Both must be excluded from CA/US's
 * expansion by the ambiguity guard in country-subdivisions.ts.
 */

test("(f) Australia's 'Victoria' does not leak into Canada's expansion", () => {
  const candidates = countryPlaceCandidates("CA", loadGazetteer());
  assert.ok(candidates);
  assert.ok(
    !candidates!.some((c) => c.value.toLowerCase() === "victoria"),
    `Canada's expansion must never contain Victoria: ${JSON.stringify(candidates)}`,
  );
});

test("(g) a US-state/country-name collision: 'Georgia' does not leak into the US's expansion", () => {
  const candidates = countryPlaceCandidates("US", loadGazetteer());
  assert.ok(candidates);
  assert.ok(
    !candidates!.some((c) => c.field === "location_country" && c.value === "Georgia"),
    `the US's expansion must never contain Georgia (the country): ${JSON.stringify(candidates)}`,
  );
});

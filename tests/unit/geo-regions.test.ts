import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRegionPhrase, regionLabel, MAX_REGION_CLAUSE_TERMS } from "../../src/lib/geo/regions";

/**
 * Pure region-membership logic (regions.ts), against the REAL committed
 * `data/geo/regions.json` — this table's whole point is to be one real
 * artifact every caller shares, so re-mocking it in a fixture would just
 * test a second, parallel copy of the same data. `resolvePlacePhrase`'s
 * WIRING of a region into a `PlaceResolution` (resolve-place.ts's
 * `resolveRegion`, using a small hand-built gazetteer) is covered separately
 * in geo-resolve-place.test.ts.
 */

test("unrecognized phrase resolves to null", () => {
  assert.equal(resolveRegionPhrase("zzznotaregion"), null);
  assert.equal(regionLabel("zzznotaregion"), null);
});

test("North America includes US, Canada, and Mexico", () => {
  const members = resolveRegionPhrase("north america");
  assert.ok(members);
  for (const iso2 of ["US", "CA", "MX"]) {
    assert.ok(members!.includes(iso2), `expected ${iso2} in ${JSON.stringify(members)}`);
  }
});

test("EMEA resolves to a non-empty member list spanning Europe, Africa, and the Middle East", () => {
  const members = resolveRegionPhrase("emea");
  assert.ok(members);
  assert.ok(members!.length > 50, `expected a large EMEA membership, got ${members!.length}`);
  for (const iso2 of ["DE", "NG", "AE"]) {
    assert.ok(members!.includes(iso2), `expected ${iso2} in EMEA, got ${JSON.stringify(members)}`);
  }
});

test("APAC resolves to a non-empty member list and excludes the Middle East", () => {
  const members = resolveRegionPhrase("apac");
  assert.ok(members);
  assert.ok(members!.includes("JP"));
  assert.ok(members!.includes("AU"));
  assert.ok(!members!.includes("AE"), "APAC should not pull in Middle East members via the Asia continent");
});

test("a region alias resolves the same regardless of case or surrounding whitespace", () => {
  const lower = resolveRegionPhrase("north america");
  const upper = resolveRegionPhrase("NORTH AMERICA");
  const padded = resolveRegionPhrase("  North America  ");
  assert.ok(lower && upper && padded);
  assert.deepEqual([...upper!].sort(), [...lower!].sort());
  assert.deepEqual([...padded!].sort(), [...lower!].sort());
});

test("a punctuation variant of the same alias resolves to the same members", () => {
  const ampersand = resolveRegionPhrase("uk & ireland");
  const spelledOut = resolveRegionPhrase("UK and Ireland");
  assert.ok(ampersand && spelledOut);
  assert.deepEqual([...ampersand!].sort(), [...spelledOut!].sort());
  assert.deepEqual([...ampersand!].sort(), ["GB", "IE"]);
});

test("Latin America excludes the US and Canada despite spanning the same two continents as 'Americas'", () => {
  const latam = resolveRegionPhrase("latam");
  const americas = resolveRegionPhrase("americas");
  assert.ok(latam && americas);
  assert.ok(!latam!.includes("US") && !latam!.includes("CA"));
  assert.ok(americas!.includes("US") && americas!.includes("CA"));
  assert.ok(latam!.includes("BR") && latam!.includes("MX"));
});

test("regionLabel gives a display name distinct from the raw typed phrase", () => {
  assert.equal(regionLabel("emea"), "EMEA");
  assert.equal(regionLabel("north america"), "North America");
});

test("MAX_REGION_CLAUSE_TERMS is a positive, sane cap", () => {
  assert.ok(MAX_REGION_CLAUSE_TERMS > 0 && MAX_REGION_CLAUSE_TERMS <= 200);
});

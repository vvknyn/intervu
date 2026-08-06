import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGazetteerIndex, type GazetteerData } from "../../src/lib/geo/gazetteer";
import { resolvePlacePhrase, scanPlacePhrases, countryPlaceCandidates, PLACE_MIN_LENGTH } from "../../src/lib/geo/resolve-place";

/**
 * A small, hand-built fixture — not the committed ~70k-city artifact — so
 * these tests are fast, deterministic, and independent of a future GeoNames
 * refresh. Coordinates are real-ish (Toronto-area cities really are this
 * close together) so the radius math means something.
 */
const DATA: GazetteerData = {
  countries: [
    ["CA", "CAN", "Canada"],
    ["US", "USA", "United States"],
  ],
  admin1: [
    ["CA", "ON", "Ontario"],
    ["US", "CA", "California"],
  ],
  cities: [
    // Toronto-area cluster, all within ~50km of Toronto.
    ["Toronto", null, 43.70011, -79.4163, "CA", "ON", 2794356],
    ["Markham", null, 43.8561, -79.337, "CA", "ON", 338503],
    ["Mississauga", null, 43.5896, -79.6441, "CA", "ON", 717961],
    ["Brampton", null, 43.7315, -79.7624, "CA", "ON", 656480],
    ["Vaughan", null, 43.8361, -79.4983, "CA", "ON", 323103],
    // Same name as a real Georgia, US city — the cross-country homonym the
    // radius expansion must not leak (bug: a bare `location_city = "Richmond
    // Hill"` clause matches BOTH; the fix scopes it to Ontario/Canada).
    ["Richmond Hill", null, 43.8828, -79.4403, "CA", "ON", 202022],
    // Far outside the radius — must never show up as a Toronto neighbor.
    ["Ottawa", null, 45.4215, -75.6972, "CA", "ON", 934243],
    // Same NAME as the Canadian province, but a real (smaller) US city —
    // proves admin1 wins the ambiguity, not a coin flip.
    ["Ontario", null, 34.0633, -117.6509, "US", "CA", 175265],
    // Ambiguous worldwide bare name — population picks the anchor.
    ["Springfield", null, 39.79, -89.65, "US", null, 114230], // Illinois — bigger
    ["Springfield", null, 37.2, -93.3, "US", null, 43000], // Missouri — smaller
  ],
};

const GAZETTEER = buildGazetteerIndex(DATA);

function fieldValues(candidates: { field: string; value: string }[], field: string): string[] {
  return candidates.filter((c) => c.field === field).map((c) => c.value);
}

test("city resolution: Toronto expands to itself plus same-country neighbors within the radius", () => {
  const r = resolvePlacePhrase("toronto", GAZETTEER);
  assert.ok(r, "Toronto must resolve");
  assert.equal(r!.entity.type, "city");
  const cities = fieldValues(r!.candidates, "location_city");
  assert.ok(cities.includes("Toronto"));
  assert.ok(cities.includes("Markham"), `expected Markham in ${JSON.stringify(cities)}`);
  assert.ok(cities.includes("Mississauga"));
  assert.ok(cities.includes("Brampton"));
  assert.ok(cities.includes("Vaughan"));
  assert.ok(cities.includes("Richmond Hill"));
  assert.ok(!cities.includes("Ottawa"), "Ottawa is ~350km away — outside the radius");
});

test("city resolution carries a countryScope — the resolved country's own candidates, for query-understanding.ts to AND against the city OR-set", () => {
  const r = resolvePlacePhrase("toronto", GAZETTEER);
  assert.ok(r);
  const scopeCountries = fieldValues(r!.countryScope, "location_country");
  assert.deepEqual(scopeCountries.sort(), ["CA", "CAN", "Canada", "Canada"].sort());
});

test("admin1/country resolutions carry no countryScope — they already ARE the region, nothing left to scope", () => {
  const admin1 = resolvePlacePhrase("ontario", GAZETTEER); // resolves as admin1 — see the priority test below
  assert.ok(admin1);
  assert.equal(admin1!.entity.type, "admin1");
  assert.deepEqual(admin1!.countryScope, []);
  const country = resolvePlacePhrase("canada", GAZETTEER);
  assert.ok(country);
  assert.deepEqual(country!.countryScope, []);
});

test("case-insensitive: 'TORONTO' resolves the same as 'toronto'", () => {
  const r = resolvePlacePhrase("TORONTO", GAZETTEER);
  assert.ok(r);
  assert.equal(r!.entity.name, "Toronto");
});

test("admin1 resolution: Ontario expands to its name and its code", () => {
  const r = resolvePlacePhrase("ontario", GAZETTEER);
  assert.ok(r);
  assert.equal(r!.entity.type, "admin1", "the province must win over the same-named US city");
  const states = fieldValues(r!.candidates, "location_state");
  assert.deepEqual(states.sort(), ["ON", "Ontario"]);
  // The ambiguity policy means the same-named city's radius expansion never
  // fires — no location_city candidates at all for this phrase.
  assert.equal(fieldValues(r!.candidates, "location_city").length, 0);
});

test("bare 2-letter admin1 code is never a typed lookup key — collides with English", () => {
  assert.equal(resolvePlacePhrase("on", GAZETTEER), null);
  assert.equal(resolvePlacePhrase("in", GAZETTEER), null);
  assert.equal("on".length < PLACE_MIN_LENGTH, true);
});

test("country resolution: full name expands to name + ISO2 + ISO3 + compound-prefix candidate", () => {
  const r = resolvePlacePhrase("canada", GAZETTEER);
  assert.ok(r);
  assert.equal(r!.entity.type, "country");
  const countries = r!.candidates.filter((c) => c.field === "location_country");
  assert.deepEqual(
    countries.map((c) => c.value).sort(),
    ["CA", "CAN", "Canada", "Canada"].sort(),
  );
  const prefix = countries.find((c) => c.matchMode === "prefix");
  assert.ok(prefix, "must carry a prefix-mode candidate for the 'Canada - X' compound pattern");
  assert.equal(prefix!.value, "Canada");
});

test("country ISO3 code (3 letters) IS a typeable lookup key", () => {
  const r = resolvePlacePhrase("CAN", GAZETTEER);
  assert.ok(r);
  assert.equal(r!.entity.type, "country");
  assert.equal(r!.entity.name, "Canada");
});

test("country ISO2 code (2 letters) is never a typed lookup key", () => {
  assert.equal(resolvePlacePhrase("ca", GAZETTEER), null);
  assert.equal(resolvePlacePhrase("us", GAZETTEER), null);
});

test("countryPlaceCandidates: ISO2 -> the same expansion set a typed name would produce (the IP default's entry point)", () => {
  const candidates = countryPlaceCandidates("US", GAZETTEER);
  assert.ok(candidates);
  assert.deepEqual(
    candidates!.map((c) => c.value).sort(),
    ["US", "USA", "United States", "United States"].sort(),
  );
  assert.equal(countryPlaceCandidates("ZZ", GAZETTEER), null, "unknown ISO2 resolves to nothing");
});

test("ambiguous worldwide city name: the more populous match anchors the radius search", () => {
  const r = resolvePlacePhrase("springfield", GAZETTEER);
  assert.ok(r);
  assert.equal(r!.entity.type, "city");
  assert.equal(r!.entity.countryCode, "US");
  // Both Springfields are US so this only proves ONE was picked, not a
  // union of both — the class-wide behavior under test.
  const cities = fieldValues(r!.candidates, "location_city");
  assert.equal(cities.filter((c) => c === "Springfield").length, 1);
});

test("cross-country homonym: 'london' anchors on whichever population wins, and countryScope is THAT country only — never both", () => {
  const ukHeavy = buildGazetteerIndex({
    countries: [
      ["CA", "CAN", "Canada"],
      ["GB", "GBR", "United Kingdom"],
    ],
    admin1: [["CA", "ON", "Ontario"]],
    cities: [
      ["London", null, 51.5074, -0.1278, "GB", null, 8961989], // real UK London — much bigger
      ["London", null, 42.9849, -81.2453, "CA", "ON", 404699], // real London, Ontario
    ],
  });
  const r = resolvePlacePhrase("london", ukHeavy);
  assert.ok(r);
  assert.equal(r!.entity.countryCode, "GB", "the bigger London (UK) wins the bare-name ambiguity");
  const scopeCountries = fieldValues(r!.countryScope, "location_country");
  assert.ok(scopeCountries.includes("United Kingdom"));
  assert.ok(!scopeCountries.includes("Canada"), "must never ALSO scope to Canada — that's the leak the fix closes");
});

test("cross-country homonym, mirrored: when Canada's London is the more populous match, countryScope is Canada only — never UK", () => {
  const caHeavy = buildGazetteerIndex({
    countries: [
      ["CA", "CAN", "Canada"],
      ["GB", "GBR", "United Kingdom"],
    ],
    admin1: [["CA", "ON", "Ontario"]],
    cities: [
      ["London", null, 51.5074, -0.1278, "GB", null, 100000], // fixture-only weighting to flip the anchor
      ["London", null, 42.9849, -81.2453, "CA", "ON", 404699],
    ],
  });
  const r = resolvePlacePhrase("london", caHeavy);
  assert.ok(r);
  assert.equal(r!.entity.countryCode, "CA");
  const scopeCountries = fieldValues(r!.countryScope, "location_country");
  assert.ok(scopeCountries.includes("Canada"));
  assert.ok(!scopeCountries.includes("United Kingdom"), "must never ALSO scope to the UK — same invariant, mirrored");
});

test("non-place words never resolve — no denylist needed, they simply aren't in the gazetteer", () => {
  for (const word of ["production", "management", "remote", "hybrid", "onsite", "unknown", "the"]) {
    assert.equal(resolvePlacePhrase(word, GAZETTEER), null, `"${word}" must not resolve`);
  }
});

test("digit-bearing phrases never resolve", () => {
  assert.equal(resolvePlacePhrase("2 locations", GAZETTEER), null);
});

test("scanPlacePhrases: longest-match-first, residual text preserved in typed order", () => {
  const { residualQ, resolutions } = scanPlacePhrases("senior engineer toronto canada", GAZETTEER);
  assert.equal(residualQ, "senior engineer");
  assert.equal(resolutions.length, 2);
  assert.equal(resolutions[0].entity.name, "Toronto");
  assert.equal(resolutions[1].entity.name, "Canada");
});

test("scanPlacePhrases: punctuation between places is irrelevant, both still resolve", () => {
  const { residualQ, resolutions } = scanPlacePhrases("Product Manager - Toronto, Canada", GAZETTEER);
  assert.equal(residualQ, "Product Manager");
  assert.deepEqual(
    resolutions.map((r) => r.entity.name),
    ["Toronto", "Canada"],
  );
});

test("scanPlacePhrases: unrecognized words survive as content", () => {
  const { residualQ, resolutions } = scanPlacePhrases("product manager lisbon", GAZETTEER);
  assert.equal(residualQ, "product manager lisbon");
  assert.equal(resolutions.length, 0);
});

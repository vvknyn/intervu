import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGazetteerIndex, type GazetteerData } from "../../src/lib/geo/gazetteer";
import {
  resolvePlacePhrase,
  scanPlacePhrases,
  countryPlaceCandidates,
  buildCityVariantIndex,
  scopeCityCandidates,
  buildAmbiguousCityNames,
  preferStrictCity,
  PLACE_MIN_LENGTH,
} from "../../src/lib/geo/resolve-place";
import type { PlaceClause } from "../../src/lib/jobs/types";
import { JOBS_SYNONYMS } from "../../src/lib/jobs/meilisearch";

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
    ["AU", "AUS", "Australia"],
  ],
  admin1: [
    ["CA", "ON", "Ontario"],
    ["US", "CA", "California"],
    ["US", "GA", "Georgia"],
    ["AU", "NSW", "New South Wales"],
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
    // The homonyms the two comments above only DESCRIBED. Until they existed
    // as rows, the fixture could not actually distinguish "scoped because
    // the name is shared with another country" from "scoped always" — and
    // `scopeCityCandidates` reads ambiguity off the gazetteer, so a fixture
    // that omits the twin claims a name is unique when the real artifact
    // knows it isn't (Richmond Hill: CA+US, Toronto: CA+AU).
    ["Richmond Hill", null, 31.9377, -81.3037, "US", "GA", 9281],
    ["Toronto", null, -33.0167, 151.5833, "AU", "NSW", 5386],
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

test("city resolution: { radius: false } is city-strict — primary city and name variants only, no radius neighbors", () => {
  const r = resolvePlacePhrase("toronto", GAZETTEER, false, { radius: false });
  assert.ok(r, "Toronto must resolve");
  assert.equal(r!.entity.type, "city");
  const cities = fieldValues(r!.candidates, "location_city");
  assert.ok(cities.includes("Toronto"));
  for (const excluded of ["Mississauga", "Markham", "Brampton", "Vaughan", "Richmond Hill", "Ottawa"]) {
    assert.ok(!cities.includes(excluded), `expected ${excluded} excluded from strict city filter: ${JSON.stringify(cities)}`);
  }
});

test("city resolution carries a countryScope — the resolved country's own candidates, for query-understanding.ts to AND against the city OR-set", () => {
  const r = resolvePlacePhrase("toronto", GAZETTEER);
  assert.ok(r);
  // Same note as the country-resolution tests above — the shared fixture's
  // Ontario/Toronto/etc. rows also contribute CA subdivision candidates to
  // countryScope now; this only proves the original base four survive.
  const scopeCountries = fieldValues(r!.countryScope, "location_country");
  for (const expected of ["CA", "CAN", "Canada"]) {
    assert.ok(scopeCountries.includes(expected), `expected ${expected} in ${JSON.stringify(scopeCountries)}`);
  }
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
  // The shared GAZETTEER fixture's Ontario/Toronto/etc. rows also surface
  // here as CA subdivision candidates (country-subdivisions.ts, exhaustively
  // covered by tests/unit/jobs-location-country-expansion.test.ts) — this
  // test only proves the original base four are still present among them.
  const values = countries.map((c) => c.value);
  for (const expected of ["CA", "CAN", "Canada"]) {
    assert.ok(values.includes(expected), `expected ${expected} in ${JSON.stringify(values)}`);
  }
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

test("country ISO2 code (2 letters) is never a typed lookup key on its own — 'ca' still isn't; 'us' is now a curated alias (see the alias tests below)", () => {
  assert.equal(resolvePlacePhrase("ca", GAZETTEER), null);
});

test("countryPlaceCandidates: ISO2 -> the same expansion set a typed name would produce (the IP default's entry point)", () => {
  const candidates = countryPlaceCandidates("US", GAZETTEER);
  assert.ok(candidates);
  // Same note as the Canada test above — the shared fixture's California/
  // Ontario(city)/Springfield rows also contribute US subdivision
  // candidates now; this only proves the original base four survive.
  const values = candidates!.map((c) => c.value);
  for (const expected of ["US", "USA", "United States"]) {
    assert.ok(values.includes(expected), `expected ${expected} in ${JSON.stringify(values)}`);
  }
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

/* ------------------------- curated place aliases ------------------------- *
 * Small, hand-reviewed nicknames/abbreviations (UK/USA/NYC/SF/LA/DC/Bay Area)
 * a searcher types that the gazetteer's plain name/ISO lookups never reach —
 * see PLACE_ALIASES' doc comment (resolve-place.ts) for why. Own fixture:
 * needs United Kingdom (absent from the shared GAZETTEER above) and a
 * "Washington" that's BOTH a real city (DC) and a same-named admin1 (the
 * state) — the exact ambiguity the "dc" alias has to resolve past.
 */
const ALIAS_DATA: GazetteerData = {
  countries: [
    ["GB", "GBR", "United Kingdom"],
    ["US", "USA", "United States"],
  ],
  admin1: [
    ["US", "WA", "Washington"], // the STATE — "dc" must resolve to the CITY below, not this
  ],
  cities: [
    ["New York City", null, 40.71427, -74.00597, "US", "NY", 8804190],
    ["San Francisco", null, 37.77493, -122.41942, "US", "CA", 827526],
    ["Oakland", null, 37.80437, -122.2708, "US", "CA", 419267], // ~13km from SF — within the 50km radius
    ["San Jose", null, 37.33939, -121.89496, "US", "CA", 997368], // ~67km from SF — OUTSIDE the radius
    ["Los Angeles", null, 34.05223, -118.24368, "US", "CA", 3820914],
    ["Washington", null, 38.89511, -77.03637, "US", "DC", 689545], // the CITY
  ],
};
const ALIAS_GAZETTEER = buildGazetteerIndex(ALIAS_DATA);

test("alias: 'uk' and 'u.k.' resolve to the United Kingdom, name+ISO2+ISO3+prefix candidates, just like typing the full name", () => {
  for (const phrase of ["uk", "u.k.", "UK"]) {
    const r = resolvePlacePhrase(phrase, ALIAS_GAZETTEER);
    assert.ok(r, `"${phrase}" must resolve`);
    assert.equal(r!.entity.type, "country");
    assert.equal(r!.entity.name, "United Kingdom");
    const countries = fieldValues(r!.candidates, "location_country");
    assert.deepEqual(countries.sort(), ["GB", "GBR", "United Kingdom", "United Kingdom"].sort());
  }
});

test("alias: 'usa', 'u.s.', 'u.s.a.' all resolve to the United States", () => {
  for (const phrase of ["usa", "u.s.", "u.s.a."]) {
    const r = resolvePlacePhrase(phrase, ALIAS_GAZETTEER);
    assert.ok(r, `"${phrase}" must resolve`);
    assert.equal(r!.entity.name, "United States");
  }
});

test("the 'us' ambiguity: guarded (free-text) rejects it as a place — it's the pronoun in \"let us know\" — but an explicit, unguarded lookup (the location box's call shape) resolves it to the United States", () => {
  assert.equal(resolvePlacePhrase("us", ALIAS_GAZETTEER, true), null, "free-text guard must win — 'us' stays a content word");
  const r = resolvePlacePhrase("us", ALIAS_GAZETTEER, false);
  assert.ok(r, "an explicit (non-free-text) lookup must still resolve 'us'");
  assert.equal(r!.entity.name, "United States");
});

test("alias: 'nyc' resolves to the real New York City gazetteer entry", () => {
  const r = resolvePlacePhrase("nyc", ALIAS_GAZETTEER);
  assert.ok(r);
  assert.equal(r!.entity.type, "city");
  assert.equal(r!.entity.name, "New York City");
});

test("alias: 'sf' resolves to San Francisco and still gets its normal radius-neighbor expansion (Oakland, ~13km, is in range)", () => {
  const r = resolvePlacePhrase("sf", ALIAS_GAZETTEER);
  assert.ok(r);
  assert.equal(r!.entity.name, "San Francisco");
  const cities = fieldValues(r!.candidates, "location_city");
  assert.ok(cities.includes("San Francisco"));
  assert.ok(cities.includes("Oakland"), `expected Oakland (within the radius) in ${JSON.stringify(cities)}`);
  assert.ok(!cities.includes("San Jose"), "San Jose is ~67km out — outside SF's own radius, which is exactly why 'bay area' below anchors it explicitly");
});

test("alias: 'la' resolves to Los Angeles", () => {
  const r = resolvePlacePhrase("la", ALIAS_GAZETTEER);
  assert.ok(r);
  assert.equal(r!.entity.name, "Los Angeles");
});

test("alias: 'dc' resolves to the Washington CITY, not the same-named Washington STATE admin1 — the exact ambiguity a plain re-lookup of \"washington\" would get wrong", () => {
  const r = resolvePlacePhrase("dc", ALIAS_GAZETTEER);
  assert.ok(r);
  assert.equal(r!.entity.type, "city");
  assert.equal(r!.entity.countryCode, "US");
  const cities = fieldValues(r!.candidates, "location_city");
  assert.ok(cities.includes("Washington"));
  assert.equal(fieldValues(r!.candidates, "location_state").length, 0, "must not carry the STATE's candidates");
});

test("alias: 'bay area' resolves to a 3-city any-clause (San Francisco, Oakland, San Jose) — reaching San Jose is the whole point (see the 'sf' test above)", () => {
  const r = resolvePlacePhrase("bay area", ALIAS_GAZETTEER);
  assert.ok(r);
  const cities = fieldValues(r!.candidates, "location_city").sort();
  assert.deepEqual(cities, ["Oakland", "San Francisco", "San Jose"]);
});

test("scanPlacePhrases: 'bay area' resolves as one 2-word phrase inside a real query, longest-match-first", () => {
  const { residualQ, resolutions } = scanPlacePhrases("staff engineer bay area", ALIAS_GAZETTEER);
  assert.equal(residualQ, "staff engineer");
  assert.equal(resolutions.length, 1);
  assert.deepEqual(
    fieldValues(resolutions[0].candidates, "location_city").sort(),
    ["Oakland", "San Francisco", "San Jose"],
  );
});

test("non-aliased control: a plain full country name resolves exactly as it did before the alias table existed", () => {
  const viaName = resolvePlacePhrase("united states", ALIAS_GAZETTEER);
  const viaAlias = resolvePlacePhrase("usa", ALIAS_GAZETTEER);
  assert.ok(viaName && viaAlias);
  assert.deepEqual(viaName!.candidates, viaAlias!.candidates);
});

test("non-aliased control: a random unrecognized word is still not a place", () => {
  assert.equal(resolvePlacePhrase("zzznotaplace", ALIAS_GAZETTEER), null);
});

/* ------------------------- S2: ISO3 vs registered synonyms ------------------------- *
 * Live bug (search-audit.md class 2): "swe" is BOTH Sweden's ISO3 code AND
 * this app's registered Meilisearch synonym for "software engineer"
 * (JOBS_SYNONYMS, jobs/meilisearch.ts). `resolveCountry`'s `byIso3` branch
 * resolved it to Sweden before the synonym ever reached Meilisearch,
 * degrading the search to "browse Sweden". Fix: GUARD_WORDS now unions in
 * every JOBS_SYNONYMS key, derived — not hand-copied — so this protects
 * every CURRENT and FUTURE synonym, not a "swe" special case. A fictitious
 * "Sreland" (ISO3 "SRE") proves that: "sre" is also a registered synonym
 * (site reliability engineer) with no REAL country collision today, so
 * without a class-wide fix this exact test would have passed by accident.
 */
const ISO_DATA: GazetteerData = {
  countries: [
    ["SE", "SWE", "Sweden"],
    ["DE", "DEU", "Germany"],
    ["XX", "SRE", "Sreland"], // fictitious — see doc comment above
  ],
  admin1: [],
  cities: [],
};
const ISO_GAZETTEER = buildGazetteerIndex(ISO_DATA);

test("S2 headline: 'swe' — a registered query synonym that's ALSO Sweden's ISO3 code — never resolves as a place under the free-text guard", () => {
  assert.equal(resolvePlacePhrase("swe", ISO_GAZETTEER, true), null);
});

test("S2: 'sweden' (the full country name, not a synonym key) still resolves", () => {
  const r = resolvePlacePhrase("sweden", ISO_GAZETTEER, true);
  assert.ok(r);
  assert.equal(r!.entity.name, "Sweden");
});

test("S2 class case: 'sre' (registered synonym for site reliability engineer) is ALSO guarded — proves the fix isn't a 'swe'-only special case", () => {
  assert.equal(resolvePlacePhrase("sre", ISO_GAZETTEER, true), null);
});

test("S2 sanity: without the free-text guard, 'sre' DOES resolve to the fictitious ISO3 collision — proving the guard, not a gazetteer gap, is what blocks it above", () => {
  const r = resolvePlacePhrase("sre", ISO_GAZETTEER, false);
  assert.ok(r);
  assert.equal(r!.entity.name, "Sreland");
});

test("S2: a genuine ISO3 with no synonym collision ('deu', Germany) still resolves standalone, even with the guard on", () => {
  const r = resolvePlacePhrase("deu", ISO_GAZETTEER, true);
  assert.ok(r);
  assert.equal(r!.entity.name, "Germany");
});

test("S2: synonym-key derivation — every single-word JOBS_SYNONYMS key is guarded, by construction, against the ordinary gazetteer fixture (no hand-copied list to fall out of sync)", () => {
  for (const key of Object.keys(JOBS_SYNONYMS)) {
    if (key.includes(" ")) continue; // the guard only ever applies to single tokens (module doc)
    assert.equal(
      resolvePlacePhrase(key, GAZETTEER, true),
      null,
      `expected registered synonym "${key}" to never resolve as a place under the free-text guard`,
    );
  }
});

/* ------------------------- renamed/transliterated cities ------------------------- *
 * R3 (2026-08-09 user report): "material science" in "bangalore" returned
 * unrelated results because the gazetteer only ever indexed "Bengaluru" —
 * "bangalore" didn't resolve as a place AT ALL, so it fell through to a
 * full-text content word. Root cause: a class of renamed cities where the
 * live corpus is genuinely split across old and new spellings (see
 * CITY_NAME_VARIANTS's doc, resolve-place.ts). Own fixture: needs a city
 * pair the gazetteer indexes ONLY under the canonical spelling (Bengaluru,
 * Kyiv), plus two SAME-NAMED but unrelated real towns (Calcutta/ZA,
 * Madras/US) that the renamed-city redirect must win over, not fall through
 * to — proves the fix isn't a Bangalore-only special case.
 */
const RENAME_DATA: GazetteerData = {
  countries: [
    ["IN", "IND", "India"],
    ["UA", "UKR", "Ukraine"],
    ["ZA", "ZAF", "South Africa"],
    ["US", "USA", "United States"],
    ["CA", "CAN", "Canada"], // Toronto's country, for the control test
  ],
  admin1: [],
  cities: [
    ["Bengaluru", null, 12.97194, 77.59369, "IN", "19", 8495492],
    ["Kolkata", null, 22.56263, 88.363, "IN", "18", 4631392],
    ["Chennai", null, 13.08784, 80.27847, "IN", "16", 4681087],
    ["Kyiv", null, 50.45466, 30.5238, "UA", "12", 2952301],
    ["Toronto", null, 43.70011, -79.4163, "CA", "ON", 2794356],
    // Same-named but UNRELATED real towns the gazetteer legitimately
    // indexes under their own name — the redirect must win over these, not
    // fall through to them (see CITY_NAME_VARIANTS's doc).
    ["Calcutta", null, -24.98317, 31.23485, "ZA", "07", 35864],
    ["Madras", null, 44.63345, -121.12949, "US", "OR", 6662],
  ],
};
const RENAME_GAZETTEER = buildGazetteerIndex(RENAME_DATA);

test("renamed city, alias direction: 'bangalore' resolves to the Bengaluru entity (the gazetteer indexes no other name)", () => {
  const r = resolvePlacePhrase("bangalore", RENAME_GAZETTEER);
  assert.ok(r, "'bangalore' must resolve");
  assert.equal(r!.entity.type, "city");
  assert.equal(r!.entity.name, "Bengaluru");
  assert.equal(r!.entity.countryCode, "IN");
});

test("renamed city, variant-expanded clause shape: both spellings are ANY-of candidates on location_city, ready for renderPlaceClause's OR", () => {
  const r = resolvePlacePhrase("bangalore", RENAME_GAZETTEER);
  assert.ok(r);
  const cities = fieldValues(r!.candidates, "location_city");
  assert.ok(cities.includes("Bengaluru"), `expected Bengaluru in ${JSON.stringify(cities)}`);
  assert.ok(cities.includes("Bangalore"), `expected Bangalore in ${JSON.stringify(cities)}`);
});

test("renamed city, canonical direction: typing 'bengaluru' reaches the SAME variant-expanded candidate set as typing the alias 'bangalore' — one source, both directions", () => {
  const viaAlias = resolvePlacePhrase("bangalore", RENAME_GAZETTEER);
  const viaCanonical = resolvePlacePhrase("bengaluru", RENAME_GAZETTEER);
  assert.ok(viaAlias && viaCanonical);
  assert.deepEqual(
    fieldValues(viaAlias!.candidates, "location_city").sort(),
    fieldValues(viaCanonical!.candidates, "location_city").sort(),
  );
});

test("renamed city, non-Indian rename: 'kiev' resolves to Kyiv and expands to include 'Kiev' as a candidate too — proves the fix is class-wide, not a Bangalore special case", () => {
  const r = resolvePlacePhrase("kiev", RENAME_GAZETTEER);
  assert.ok(r, "'kiev' must resolve");
  assert.equal(r!.entity.name, "Kyiv");
  const cities = fieldValues(r!.candidates, "location_city");
  assert.ok(cities.includes("Kyiv"));
  assert.ok(cities.includes("Kiev"));
});

test("renamed city, collision guard: 'calcutta' resolves to Kolkata (the historical rename), NOT the same-named real town in South Africa the gazetteer also indexes", () => {
  const r = resolvePlacePhrase("calcutta", RENAME_GAZETTEER);
  assert.ok(r);
  assert.equal(r!.entity.name, "Kolkata");
  assert.equal(r!.entity.countryCode, "IN");
  const cities = fieldValues(r!.candidates, "location_city");
  assert.ok(cities.includes("Calcutta"), "the alias spelling must still be an ANY-of candidate");
  assert.ok(cities.includes("Kolkata"));
});

test("renamed city, collision guard mirrored: 'madras' resolves to Chennai, NOT the same-named real town in Oregon, US", () => {
  const r = resolvePlacePhrase("madras", RENAME_GAZETTEER);
  assert.ok(r);
  assert.equal(r!.entity.name, "Chennai");
  assert.equal(r!.entity.countryCode, "IN");
});

test("control: a single-name city with no renamed-city table entry ('Toronto') resolves exactly as before — no phantom variant candidates", () => {
  const r = resolvePlacePhrase("toronto", RENAME_GAZETTEER);
  assert.ok(r);
  const cities = fieldValues(r!.candidates, "location_city");
  assert.deepEqual(cities, ["Toronto"]);
});

test("canonical-missing guard: a table entry pointing at a city the gazetteer doesn't recognize is dropped, not thrown — proven against a deliberately-bad fixture table, not the real CITY_NAME_VARIANTS constant", () => {
  const badTable = { atlantis: "nonexistent-city-xyz" };
  const index = buildCityVariantIndex(badTable, RENAME_GAZETTEER);
  assert.equal(index.has("nonexistent-city-xyz"), false, "a canonical the gazetteer doesn't have must never appear in the index");
  assert.equal(index.size, 0);
});

test("canonical-missing guard, real table: every CITY_NAME_VARIANTS canonical actually exists in the committed gazetteer — this test fails if a future bad entry slips in", async () => {
  const { loadGazetteer } = await import("../../src/lib/geo/gazetteer");
  // Re-derive the real table's canonicals via the resolver's own public
  // surface: resolving each alias must succeed end-to-end against the real,
  // committed ~70k-city artifact — a canonical typo would resolve to null
  // here even though buildCityVariantIndex silently drops it upstream.
  const gazetteer = loadGazetteer();
  for (const alias of ["bangalore", "bombay", "calcutta", "madras", "kiev", "saigon", "peking", "gurgaon"]) {
    const r = resolvePlacePhrase(alias, gazetteer);
    assert.ok(r, `renamed-city alias "${alias}" must resolve against the real committed gazetteer`);
  }
});

/**
 * The country scope only earns its cost when a name is shared across
 * countries. Applying it unconditionally ANDs against `location_country`, a
 * field the corpus fills far less reliably than `location_city` — measured
 * on the live index, 17 of the 20 Bengaluru/Bangalore polymer postings carry
 * a wrong country ('Bengaluru' echoed from the city, or a fabricated 'United
 * States' from raw text reading "Bangalore, KA, IN, 560066"), so the scope
 * was discarding real matches to prevent a collision that cannot happen.
 */
test("scopeCityCandidates: an unambiguous primary drops the scope AND any candidate that needed it", () => {
  const candidates = [
    { field: "location_city" as const, value: "Bengaluru" },
    { field: "location_city" as const, value: "Bangalore" },
    { field: "location_city" as const, value: "Springfield" }, // shared with other countries
  ];
  const scope = [{ field: "location_country" as const, value: "India" }];
  const out = scopeCityCandidates(candidates, scope, "Bengaluru", (n) => n === "Springfield");
  assert.deepEqual(out.countryScope, [], "nothing to disambiguate -> no scope");
  assert.deepEqual(
    out.candidates.map((c) => c.value),
    ["Bengaluru", "Bangalore"],
    "an unscoped clause must not offer a name that was only safe while scoped",
  );
});

test("scopeCityCandidates: an ambiguous primary keeps scope and candidates exactly as-is", () => {
  const candidates = [
    { field: "location_city" as const, value: "Richmond Hill" },
    { field: "location_city" as const, value: "Markham" },
  ];
  const scope = [{ field: "location_country" as const, value: "Canada" }];
  const out = scopeCityCandidates(candidates, scope, "Richmond Hill", () => true);
  assert.deepEqual(out.countryScope, scope);
  assert.deepEqual(out.candidates, candidates);
});

test("buildAmbiguousCityNames: only names the gazetteer knows in MORE THAN ONE country", () => {
  const names = buildAmbiguousCityNames(GAZETTEER);
  assert.ok(names.has("richmond hill"), "CA + US");
  assert.ok(names.has("toronto"), "CA + AU");
  assert.ok(!names.has("mississauga"), "CA only — a scope could never disambiguate it");
  assert.ok(
    !names.has("springfield"),
    "two Springfields, both US — same-country duplicates are not a cross-country collision",
  );
});

test("an unambiguous city resolves UNSCOPED, so a wrong/missing location_country can't hide it", () => {
  const r = resolvePlacePhrase("mississauga", GAZETTEER);
  assert.ok(r);
  assert.deepEqual(r!.countryScope, [], "Mississauga exists in one country — nothing to scope against");
  const cities = fieldValues(r!.candidates, "location_city");
  assert.ok(cities.includes("Mississauga"));
  for (const ambiguous of ["Toronto", "Richmond Hill"]) {
    assert.ok(
      !cities.includes(ambiguous),
      `${ambiguous} is a cross-country homonym — it must not ride along in an unscoped clause`,
    );
  }
});

test("real gazetteer, not just the reported city: renamed cities resolve to BOTH spellings and stay unscoped, while homonyms keep their scope", async () => {
  const { loadGazetteer } = await import("../../src/lib/geo/gazetteer");
  const gazetteer = loadGazetteer();

  // Both spellings must be offered — the corpus genuinely splits across them.
  for (const [typed, spellings] of [
    ["bangalore", ["Bengaluru", "Bangalore"]],
    ["bengaluru", ["Bengaluru", "Bangalore"]],
    ["bombay", ["Mumbai", "Bombay"]],
  ] as const) {
    const r = resolvePlacePhrase(typed, gazetteer);
    assert.ok(r, `${typed} must resolve`);
    assert.deepEqual(r!.countryScope, [], `${typed} names one city on earth — expected no country scope`);
    const cities = fieldValues(r!.candidates, "location_city");
    for (const spelling of spellings) {
      assert.ok(cities.includes(spelling), `expected ${spelling} among ${typed}'s candidates`);
    }
  }

  // The guard the scope exists for is untouched.
  for (const homonym of ["richmond hill", "london", "hyderabad"]) {
    const r = resolvePlacePhrase(homonym, gazetteer);
    assert.ok(r, `${homonym} must resolve`);
    assert.ok(
      r!.countryScope.length > 0,
      `${homonym} exists in more than one country — its scope must survive`,
    );
  }
});

// Region/continent wiring (resolveRegion, inserted into resolvePlacePhrase's
// priority ladder ahead of PLACE_MIN_LENGTH). Region MEMBERSHIP itself
// (which ISO2 codes belong to "North America") is tested against the real
// data/geo/regions.json in geo-regions.test.ts — these tests only cover how
// a resolved region turns into a PlaceResolution against a gazetteer
// instance, using the same small fixture as every other test above.

test("a region phrase resolves to a 'region' entity whose candidates are built from countryPlaceCandidates per member", () => {
  const r = resolvePlacePhrase("north america", GAZETTEER);
  assert.ok(r, "North America must resolve — the fixture's US and CA rows are both NA members");
  assert.equal(r!.entity.type, "region");
  assert.equal(r!.entity.countryCode, undefined, "a region spans multiple countries — no single code would be honest");
  assert.equal(r!.entity.name, "North America");
  assert.deepEqual(r!.countryScope, [], "a region already IS the scope — nothing left to AND against");

  const countries = fieldValues(r!.candidates, "location_country");
  // US and CA are both North America members in this fixture's countries
  // table — their own country-level candidates (same shape countryCandidates
  // produces for a direct "canada"/"united states" search) must be present.
  for (const expected of ["United States", "US", "USA", "Canada", "CA", "CAN"]) {
    assert.ok(countries.includes(expected), `expected ${expected} among ${JSON.stringify(countries)}`);
  }
  // Australia is a real country in this fixture but NOT a North America
  // member — it must not leak in just because it's in the gazetteer.
  assert.ok(!countries.includes("Australia"), "Australia is not a North America member");
});

test("a region alias in a different case/punctuation still resolves through resolvePlacePhrase", () => {
  const r = resolvePlacePhrase("NORTH AMERICA", GAZETTEER);
  assert.ok(r);
  assert.equal(r!.entity.type, "region");
});

test("'Georgia' resolves as the US state (admin1), never as a region — 'georgia' is not a region alias", () => {
  const r = resolvePlacePhrase("georgia", GAZETTEER);
  assert.ok(r);
  assert.equal(r!.entity.type, "admin1");
  assert.equal(r!.entity.countryCode, "US");
  const states = fieldValues(r!.candidates, "location_state");
  assert.ok(states.includes("Georgia"));
});

test("preferStrictCity: city + country drops bare country-only; two cities stay; city + state stays; country-only unchanged; phrase-bound workTypes kept; idempotent", () => {
  const toronto: PlaceClause = {
    any: [{ field: "location_city", value: "Toronto" }],
    scopedToCountry: [{ field: "location_country", value: "Canada" }],
  };
  const canada: PlaceClause = { any: [{ field: "location_country", value: "Canada" }] };
  const vancouver: PlaceClause = { any: [{ field: "location_city", value: "Vancouver" }] };
  const georgia: PlaceClause = { any: [{ field: "location_state", value: "Georgia" }] };
  const sanJose: PlaceClause = { any: [{ field: "location_city", value: "San Jose" }] };
  const canadaRemote: PlaceClause = {
    any: [{ field: "location_country", value: "Canada" }],
    workTypes: ["remote"],
  };

  assert.deepEqual(preferStrictCity([toronto, canada]), [toronto]);

  assert.deepEqual(preferStrictCity([toronto, vancouver]), [toronto, vancouver]);

  assert.deepEqual(preferStrictCity([sanJose, georgia]), [sanJose, georgia]);

  assert.deepEqual(preferStrictCity([canada]), [canada]);

  assert.deepEqual(preferStrictCity([toronto, canadaRemote]), [toronto, canadaRemote]);

  const once = preferStrictCity([toronto, canada]);
  assert.deepEqual(preferStrictCity(once), once);
});

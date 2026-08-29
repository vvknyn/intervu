import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGazetteerIndex, type GazetteerData } from "../../src/lib/geo/gazetteer";
import { isMisfiledCountryName } from "../../src/lib/geo/misfiled-country";

/**
 * The misfiled-country predicate: a corpus value that names a COUNTRY does
 * not belong under the CITY or STATE facet — unless a real city/admin1
 * genuinely carries that name (the protective lookups).
 *
 * Fixture, not the committed artifact: `buildGazetteerIndex` over a small
 * synthetic dataset, so these tests assert the RULE and stay immune to a
 * future GeoNames refresh. The fixture deliberately includes both kinds of
 * collision the rule must survive:
 *   - "Georgia": a country AND a US state (admin1 protects the States row)
 *   - "Mexico":  a country AND a city (Mexico, Missouri) AND an admin1
 *     (Estado de México)
 */
const DATA: GazetteerData = {
  countries: [
    ["CA", "CAN", "Canada"],
    ["US", "USA", "United States"],
    ["DE", "DEU", "Germany"],
    ["IN", "IND", "India"],
    ["GE", "GEO", "Georgia"],
    ["MX", "MEX", "Mexico"],
  ],
  admin1: [
    ["US", "GA", "Georgia"],
    ["US", "CA", "California"],
    ["MX", "15", "Mexico"],
  ],
  cities: [
    ["Mexico", null, 39.17, -91.88, "US", "MO", 11660],
    ["New York", null, 40.71, -74.01, "US", "NY", 8478072],
    ["Tbilisi", null, 41.69, 44.83, "GE", "51", 1118035],
  ],
};

const GAZETTEER = buildGazetteerIndex(DATA);

test("a country name under the CITY facet is misfiled — the value that surfaced this", () => {
  // Prod 2026-08-29: location_city = "Canada" (31 postings) rendered as a
  // CITIES row; picking it delivered 2 results where the country delivers
  // tens of thousands.
  assert.equal(isMisfiledCountryName("location_city", "Canada", GAZETTEER), true);
});

test("the rule is the class: other countries, and the STATE facet too", () => {
  assert.equal(isMisfiledCountryName("location_city", "United States", GAZETTEER), true);
  assert.equal(isMisfiledCountryName("location_city", "Germany", GAZETTEER), true);
  assert.equal(isMisfiledCountryName("location_state", "Canada", GAZETTEER), true);
  assert.equal(isMisfiledCountryName("location_state", "India", GAZETTEER), true);
});

test("a country name in the COUNTRY facet is correctly filed, never misfiled", () => {
  assert.equal(isMisfiledCountryName("location_country", "Canada", GAZETTEER), false);
  assert.equal(isMisfiledCountryName("location_country", "Germany", GAZETTEER), false);
});

test("an admin1 that shares a country's name protects the STATE row: Georgia stays", () => {
  // States · Georgia is 8,148 postings on prod — overwhelmingly the US
  // state. Suppressing it because a country is also named Georgia would
  // delete a real place to kill a trap.
  assert.equal(isMisfiledCountryName("location_state", "Georgia", GAZETTEER), false);
  // ...but no CITY is named Georgia, so under CITIES it is still the trap.
  assert.equal(isMisfiledCountryName("location_city", "Georgia", GAZETTEER), true);
});

test("a city that shares a country's name protects the CITY row: Mexico stays everywhere", () => {
  assert.equal(isMisfiledCountryName("location_city", "Mexico", GAZETTEER), false, "Mexico, Missouri");
  assert.equal(isMisfiledCountryName("location_state", "Mexico", GAZETTEER), false, "Estado de México");
});

test("a value the gazetteer does not know as a country is untouched, whatever it is", () => {
  // Positive-evidence-only, same stance as isMalformedLocationValue: absence
  // of gazetteer knowledge never suppresses.
  assert.equal(isMisfiledCountryName("location_city", "New York", GAZETTEER), false);
  assert.equal(isMisfiledCountryName("location_city", "Canandaigua", GAZETTEER), false);
  assert.equal(isMisfiledCountryName("location_state", "CANADA STORE SUPPORT CENTER - 7000", GAZETTEER), false);
});

test("matching folds case and padding, so the trap cannot escape by spelling", () => {
  assert.equal(isMisfiledCountryName("location_city", "CANADA", GAZETTEER), true);
  assert.equal(isMisfiledCountryName("location_city", "  canada  ", GAZETTEER), true);
});

test("country NAMES only — iso codes never match, because corpus 'CA' means California", () => {
  // iso2 CA / iso3 CAN are Canada in the fixture; matching them would
  // suppress the state abbreviation the corpus actually uses.
  assert.equal(isMisfiledCountryName("location_state", "CA", GAZETTEER), false);
  assert.equal(isMisfiledCountryName("location_state", "CAN", GAZETTEER), false);
});

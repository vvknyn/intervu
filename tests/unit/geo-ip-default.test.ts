import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGazetteerIndex, type GazetteerData } from "../../src/lib/geo/gazetteer";
import { hasLocationSignal, resolveLocationDefault } from "../../src/lib/geo/ip-default";
import { createMmdbCountryLookup } from "../../src/lib/geo/ip-country";
import type { CorpusValueChecker } from "../../src/lib/geo/corpus-values";
import type { CountryLookup } from "../../src/lib/geo/ip-country";
import type { PlaceFilter } from "../../src/lib/jobs/types";

const DATA: GazetteerData = {
  countries: [
    ["CA", "CAN", "Canada"],
    ["US", "USA", "United States"],
  ],
  admin1: [],
  cities: [],
};
const GAZETTEER = buildGazetteerIndex(DATA);

/** A checker that only ever validates the exact corpus values listed
 *  (deduping per group, like the real `createCorpusValueChecker` —
 *  resolveCountry's exact and prefix candidates for the same name both
 *  match one value). */
function fakeCorpusChecker(realValues: string[]): CorpusValueChecker {
  return async (groups) =>
    groups.map((candidates) => {
      const seen = new Set<string>();
      const out: PlaceFilter[] = [];
      for (const c of candidates) {
        const hit = realValues.find((v) => v.toLowerCase() === c.value.toLowerCase());
        if (!hit || seen.has(hit)) continue;
        seen.add(hit);
        out.push({ field: c.field, value: hit });
      }
      return out;
    });
}

test("hasLocationSignal: false with no places and no location_country facet", () => {
  assert.equal(hasLocationSignal({}), false);
  assert.equal(hasLocationSignal({ places: [] }), false);
  assert.equal(hasLocationSignal({ facets: { work_type: ["remote"] } }), false);
});

test("hasLocationSignal: true when a place was already resolved (typed query or the MCP location param)", () => {
  assert.equal(hasLocationSignal({ places: [{ any: [{ field: "location_city", value: "Toronto" }] }] }), true);
});

test("hasLocationSignal: true with an explicit location_country facet — the panel click wins over any default", () => {
  assert.equal(hasLocationSignal({ facets: { location_country: ["Canada"] } }), true);
});

test("resolveLocationDefault: IP resolves to a country the corpus has postings for", async () => {
  const lookup: CountryLookup = async () => "CA";
  const checker = fakeCorpusChecker(["Canada"]);
  const result = await resolveLocationDefault("1.2.3.4", GAZETTEER, checker, lookup);
  assert.ok(result);
  assert.equal(result!.countryCode, "CA");
  assert.deepEqual(result!.places, [{ any: [{ field: "location_country", value: "Canada" }] }]);
});

test("resolveLocationDefault: fails open when the IP doesn't resolve to a country", async () => {
  const lookup: CountryLookup = async () => null;
  const checker = fakeCorpusChecker(["Canada"]);
  assert.equal(await resolveLocationDefault("1.2.3.4", GAZETTEER, checker, lookup), null);
});

test("resolveLocationDefault: fails open when the gazetteer doesn't recognize the ISO2 db-ip returned", async () => {
  const lookup: CountryLookup = async () => "ZZ";
  const checker = fakeCorpusChecker(["Canada"]);
  assert.equal(await resolveLocationDefault("1.2.3.4", GAZETTEER, checker, lookup), null);
});

test("resolveLocationDefault: fails open when the corpus has no postings tagged with that country — never invents a filter", async () => {
  const lookup: CountryLookup = async () => "CA";
  const checker = fakeCorpusChecker([]); // corpus has nothing
  assert.equal(await resolveLocationDefault("1.2.3.4", GAZETTEER, checker, lookup), null);
});

test("createMmdbCountryLookup: a missing mmdb file fails open (null), never throws", async () => {
  const lookup = createMmdbCountryLookup("/nonexistent/path/does-not-exist.mmdb");
  const result = await lookup("8.8.8.8");
  assert.equal(result, null);
});

test("createMmdbCountryLookup: an empty/unknown IP fails open without touching the reader", async () => {
  const lookup = createMmdbCountryLookup("/nonexistent/path/does-not-exist.mmdb");
  assert.equal(await lookup(""), null);
  assert.equal(await lookup("unknown"), null);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGazetteerIndex, type GazetteerData } from "../../src/lib/geo/gazetteer";
import { applyLocationDefault, hasLocationSignal, resolveLocationDefault } from "../../src/lib/geo/ip-default";
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

test("hasLocationSignal: true with an explicit location_city or location_state facet — picked typeahead values count too", () => {
  assert.equal(hasLocationSignal({ facets: { location_city: ["Toronto"] } }), true);
  assert.equal(hasLocationSignal({ facets: { location_state: ["Ontario"] } }), true);
});

test("hasLocationSignal: override precedence — suppressLocationDefault alone (no place, no facet) still suppresses", () => {
  assert.equal(hasLocationSignal({ suppressLocationDefault: true }), true);
  assert.equal(hasLocationSignal({ suppressLocationDefault: false }), false);
});

test("hasLocationSignal: override precedence — an explicit place/facet signal keeps suppressing regardless of the override's own value", () => {
  const withPlace = { places: [{ any: [{ field: "location_city" as const, value: "Toronto" }] }] };
  assert.equal(hasLocationSignal({ ...withPlace, suppressLocationDefault: false }), true);
  assert.equal(hasLocationSignal({ ...withPlace, suppressLocationDefault: true }), true);
  const withFacet = { facets: { location_country: ["Canada"] } };
  assert.equal(hasLocationSignal({ ...withFacet, suppressLocationDefault: false }), true);
  assert.equal(hasLocationSignal({ ...withFacet, suppressLocationDefault: true }), true);
});

test("resolveLocationDefault: IP resolves to a country the corpus has postings for", async () => {
  const lookup: CountryLookup = async () => "CA";
  const checker = fakeCorpusChecker(["Canada"]);
  const result = await resolveLocationDefault("1.2.3.4", GAZETTEER, checker, lookup);
  assert.ok(result);
  assert.equal(result!.countryCode, "CA");
  // remoteAnywhere: true — resolveLocationDefault builds its country clause
  // via the shared `placeClause` factory (geo/resolve-place.ts), same as
  // every other country resolution; see jobs-remote-anywhere.test.ts for the
  // dedicated coverage of that.
  assert.deepEqual(result!.places, [{ any: [{ field: "location_country", value: "Canada" }], remoteAnywhere: true }]);
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

/* ---------------- applyLocationDefault: the searchJobs seam ---------------- */

function fakeLoadContext(realValues: string[], calls: number[] = []) {
  return async () => {
    calls.push(1);
    return { gazetteer: GAZETTEER, corpusChecker: fakeCorpusChecker(realValues) };
  };
}

test("applyLocationDefault: payload flag round-trip — suppressLocationDefault:true means no defaultedLocation, even with a resolvable IP+country", async () => {
  const lookup: CountryLookup = async () => "CA";
  const loadContext = fakeLoadContext(["Canada"]);
  const result = await applyLocationDefault(
    { q: "software engineer", suppressLocationDefault: true },
    "1.2.3.4",
    lookup,
    loadContext,
  );
  assert.equal(result.defaultedLocation, undefined);
  assert.equal(result.remoteAnywhere, undefined, "no default applied — nothing for the chip to disclose");
  assert.deepEqual(result.params, { q: "software engineer", suppressLocationDefault: true }, "params come back untouched");
});

test("applyLocationDefault: fires when nothing suppresses it — the same inputs minus the flag", async () => {
  const lookup: CountryLookup = async () => "CA";
  const loadContext = fakeLoadContext(["Canada"]);
  const result = await applyLocationDefault({ q: "software engineer" }, "1.2.3.4", lookup, loadContext);
  assert.equal(result.defaultedLocation, "CA");
  assert.deepEqual(result.params.places, [{ any: [{ field: "location_country", value: "Canada" }], remoteAnywhere: true }]);
  // Honesty fix (Defect 2): the top-level `remoteAnywhere` the client
  // renders "near {Country} or remote" from is read OFF `params.places`
  // (not assumed alongside `defaultedLocation`) — this pins that it
  // actually round-trips out of the return value, not just into it.
  assert.equal(result.remoteAnywhere, true);
});

test("applyLocationDefault: no-op (and never touches loadContext) when there's no IP or no countryLookup", async () => {
  const calls: number[] = [];
  const loadContext = fakeLoadContext(["Canada"], calls);
  const withoutIp = await applyLocationDefault({ q: "engineer" }, undefined, async () => "CA", loadContext);
  assert.equal(withoutIp.defaultedLocation, undefined);
  const withoutLookup = await applyLocationDefault({ q: "engineer" }, "1.2.3.4", undefined, loadContext);
  assert.equal(withoutLookup.defaultedLocation, undefined);
  assert.equal(calls.length, 0, "the gazetteer/corpus checker are never loaded when the default can't apply anyway");
});

test("applyLocationDefault: no-op for the dead-link id probe", async () => {
  const lookup: CountryLookup = async () => "CA";
  const result = await applyLocationDefault({ id: "job-123" }, "1.2.3.4", lookup, fakeLoadContext(["Canada"]));
  assert.equal(result.defaultedLocation, undefined);
});

test("applyLocationDefault: an explicit place already resolved suppresses it too, independent of suppressLocationDefault", async () => {
  const lookup: CountryLookup = async () => "CA";
  const params = {
    q: "engineer",
    places: [{ any: [{ field: "location_city" as const, value: "Toronto" }] }],
  };
  const result = await applyLocationDefault(params, "1.2.3.4", lookup, fakeLoadContext(["Canada"]));
  assert.equal(result.defaultedLocation, undefined);
  assert.equal(result.params, params, "same reference — nothing to change");
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

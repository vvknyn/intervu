import { test } from "node:test";
import assert from "node:assert/strict";

import { buildGazetteerIndex } from "../../src/lib/geo/gazetteer";
import {
    mergeFieldHits,
    buildLocationSuggestions,
    isLocationSelected,
    addLocationValue,
    removeLocationValue,
    prioritizeCountryMatch,
    countryCommitFieldForQuery,
    LOCATION_SUGGEST_PER_FIELD,
    type LocationSuggestGroup,
} from "../../src/lib/jobs/location-suggest";

/**
 * The location typeahead's model. The rule these all turn on: what the
 * dropdown shows as ONE place must be what the filter treats as one place,
 * so both sides fold identically (`foldForMatch`). If they disagreed the
 * dropdown would promise a count it then failed to return.
 */

test("merges spellings that differ only by accent into one row, summing their counts", () => {
    const out = mergeFieldHits("location_city", [
        { value: "Montreal", count: 234 },
        { value: "Montréal", count: 108 },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.count, 342);
});

test("labels the merged row with the corpus's DOMINANT spelling, not the first seen", () => {
    // The searcher picks a string that has to survive a round trip back
    // through place resolution, so it must be a spelling the corpus really
    // uses — and of the two, the one it uses most.
    const out = mergeFieldHits("location_city", [
        { value: "Montréal", count: 108 },
        { value: "Montreal", count: 234 },
    ]);
    assert.equal(out[0]!.label, "Montreal");
});

test("merging is not about Montreal — it holds for any diacritic", () => {
    const zurich = mergeFieldHits("location_city", [
        { value: "Zurich", count: 40 },
        { value: "Zürich", count: 900 },
    ]);
    assert.equal(zurich.length, 1);
    assert.equal(zurich[0]!.label, "Zürich");
    assert.equal(zurich[0]!.count, 940);

    const sao = mergeFieldHits("location_city", [
        { value: "Sao Paulo", count: 12 },
        { value: "São Paulo", count: 88 },
    ]);
    assert.equal(sao.length, 1);
    assert.equal(sao[0]!.count, 100);
});

test("case alone also merges, and does not merge genuinely different places", () => {
    const out = mergeFieldHits("location_city", [
        { value: "toronto", count: 10 },
        { value: "Toronto", count: 90 },
        { value: "Torino", count: 5 },
    ]);
    assert.equal(out.length, 2);
    assert.deepEqual(out.map((o) => o.label), ["Toronto", "Torino"]);
});

test("rows are ordered by merged count, so the biggest place is not buried by a spelling split", () => {
    const out = mergeFieldHits("location_city", [
        { value: "Quebec City", count: 300 },
        { value: "Montreal", count: 234 },
        { value: "Montréal", count: 108 },
    ]);
    // Montreal only outranks Quebec City once its two spellings are summed.
    assert.deepEqual(out.map((o) => o.label), ["Montreal", "Quebec City"]);
});

test("caps each field so the dropdown stays a chooser, not a browser", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ value: `City ${i}`, count: 100 - i }));
    assert.equal(mergeFieldHits("location_city", many).length, LOCATION_SUGGEST_PER_FIELD);
});

test("keys are unique per field, so the same name in two fields stays two rows", () => {
    // "Quebec" is both a city and a province. Collapsing them would filter
    // on the wrong one.
    const groups = buildLocationSuggestions({
        location_city: [{ value: "Quebec", count: 300 }],
        location_state: [{ value: "Quebec", count: 1200 }],
    });
    const keys = groups.flatMap((g) => g.items.map((i) => i.key));
    assert.equal(new Set(keys).size, keys.length);
    assert.equal(keys.length, 2);
});

test("orders groups narrowest-first so cities are not buried under country counts", () => {
    const groups = buildLocationSuggestions({
        location_country: [{ value: "Canada", count: 500_000 }],
        location_city: [{ value: "Montreal", count: 342 }],
    });
    assert.deepEqual(groups.map((g) => g.field), ["location_city", "location_country"]);
});

test("a field that could not be asked is ABSENT, not an empty group", () => {
    // `fetchFacetSearch` returns null on any backend failure. "We failed to
    // look" and "there are no matches" are different claims, and rendering
    // the second when the first is true tells the searcher a place does not
    // exist.
    const groups = buildLocationSuggestions({ location_city: [] });
    assert.deepEqual(groups, []);
});

test("selection is folded, so one spelling suppresses the other", () => {
    const suggestion = { key: "location_city:montreal", label: "Montréal", field: "location_city" as const, count: 342 };
    assert.equal(isLocationSelected(suggestion, ["Montreal"]), true);
    assert.equal(isLocationSelected(suggestion, ["Toronto"]), false);
});

test("adding is folded and idempotent — the same place cannot be filtered twice", () => {
    const once = addLocationValue([], "Montréal");
    assert.deepEqual(once, ["Montréal"]);
    // Same city, other spelling, different case: still already there.
    assert.equal(addLocationValue(once, "montreal"), once, "should return the SAME array");
    assert.equal(addLocationValue(once, "  MONTRÉAL  "), once);
    // A genuinely different place appends.
    assert.deepEqual(addLocationValue(once, "Toronto"), ["Montréal", "Toronto"]);
});

test("adding blank text is a no-op that returns the same array", () => {
    const cur = ["Toronto"];
    assert.equal(addLocationValue(cur, "   "), cur);
    assert.equal(addLocationValue(cur, ""), cur);
});

test("removing is folded too, so a chip removes the place however it was spelled", () => {
    assert.deepEqual(removeLocationValue(["Montréal", "Toronto"], "montreal"), ["Toronto"]);
    assert.deepEqual(removeLocationValue(["Montreal", "Toronto"], "Montréal"), ["Toronto"]);
    assert.deepEqual(removeLocationValue(["Toronto"], "Ottawa"), ["Toronto"]);
});

/**
 * Malformed corpus values (parser artifacts, not places) must never reach
 * the dropdown as selectable rows — see src/lib/geo/malformed-location-value.ts
 * for the positive-evidence predicate this gates on.
 */

test("drops parser-artifact hits measured live under Canada, keeps the real one", () => {
    const out = mergeFieldHits("location_country", [
        { value: "Remote Canada", count: 6097 },
        { value: "Canada -  (ON", count: 2 },
        { value: "Canada (Alberta", count: 1 },
        { value: "Canada | Logan", count: 1 },
    ]);
    assert.deepEqual(
        out.map((o) => o.label),
        ["Remote Canada"],
    );
});

test("the same drop applies to a malformed value under a different country, not just Canada", () => {
    const out = mergeFieldHits("location_country", [
        { value: "Germany", count: 4000 },
        { value: "Germany | Berlin", count: 3 },
    ]);
    assert.deepEqual(
        out.map((o) => o.label),
        ["Germany"],
    );
});

test("a real place under a less-apt heading is NOT suppressed just because it looks unfamiliar", () => {
    const out = mergeFieldHits("location_city", [
        { value: "Canary Wharf", count: 81 },
        { value: "Canton", count: 51 },
        { value: "Candelaria", count: 39 },
    ]);
    assert.deepEqual(
        out.map((o) => o.label).sort(),
        ["Canary Wharf", "Candelaria", "Canton"],
    );
});

test("malformed-value suppression does not touch group ordering", () => {
    const groups = buildLocationSuggestions({
        location_country: [
            { value: "Canada", count: 63936 },
            { value: "Canada (Alberta", count: 1 },
        ],
        location_city: [{ value: "Montreal", count: 342 }],
    });
    assert.deepEqual(groups.map((g) => g.field), ["location_city", "location_country"]);
    assert.deepEqual(
        groups.find((g) => g.field === "location_country")!.items.map((i) => i.label),
        ["Canada"],
    );
});

/**
 * Region names never render as a place suggestion (2026-08-29).
 *
 * Measured on prod: `location_city = "North America"` is a real corpus value
 * with 23 postings. The dropdown offered it under CITIES; picking it filtered
 * to those 23 rows (2 within the 30-day default), while typing the same words
 * and pressing Enter routed through the region tier and returned ~6,200. Two
 * rows reading identically, three orders of magnitude apart.
 */
test("a region name is dropped from the CITY group — the row that surfaced this", () => {
    const out = mergeFieldHits("location_city", [
        { value: "Toronto", count: 2306 },
        { value: "North America", count: 23 },
    ]);
    assert.deepEqual(out.map((o) => o.label), ["Toronto"]);
});

// The point of the rule is the CLASS, not the one value that surfaced it:
// every phrase in REGION_ALIASES, on every location field. Asserted with
// three other regions on the two other fields — a continent, an acronym
// business region, and a curated multi-country one — none of which is
// "North America" and none of which is on `location_city`.
test("the rule is not about North America, and not about the city field", () => {
    assert.deepEqual(
        mergeFieldHits("location_state", [
            { value: "Ontario", count: 900 },
            { value: "EMEA", count: 41 },
        ]).map((o) => o.label),
        ["Ontario"],
    );
    assert.deepEqual(
        mergeFieldHits("location_country", [
            { value: "Sweden", count: 500 },
            { value: "Nordics", count: 12 },
        ]).map((o) => o.label),
        ["Sweden"],
    );
    assert.deepEqual(
        mergeFieldHits("location_city", [{ value: "APAC", count: 77 }]).map((o) => o.label),
        [],
    );
});

test("matching is folded, so a region escapes by neither casing nor punctuation", () => {
    assert.deepEqual(
        mergeFieldHits("location_city", [
            { value: "north america", count: 9 },
            { value: "  Latin America  ", count: 4 },
            { value: "LATAM", count: 3 },
        ]).map((o) => o.label),
        [],
    );
});

// The gate is exact-value-only. A real place whose name merely CONTAINS a
// region word is a place, and still renders — otherwise this rule would
// quietly delete half of British Columbia.
test("a real place that merely contains a region word is untouched", () => {
    assert.deepEqual(
        mergeFieldHits("location_city", [
            { value: "North Vancouver", count: 120 },
            { value: "South America Boulevard", count: 3 },
            { value: "Asian Highway Town", count: 2 },
        ]).map((o) => o.label).sort(),
        ["Asian Highway Town", "North Vancouver", "South America Boulevard"],
    );
});

test("a group whose only value was a region name disappears rather than rendering empty", () => {
    const groups = buildLocationSuggestions({
        location_city: [{ value: "North America", count: 23 }],
        location_country: [{ value: "United States", count: 500000 }],
    });
    assert.deepEqual(groups.map((g) => g.field), ["location_country"]);
});

/**
 * Country names misfiled into the city/state facets never render there
 * (2026-08-29, the "just 2 results?" report).
 *
 * Measured on prod: `location_city = "Canada"` is a real corpus value with
 * 31 postings, so typing "Canada" offered a CITIES · Canada row beside the
 * honest Countries · Canada row (66,010). Picking the city row filtered the
 * exact literal → 2 results in the default 30 days, under a relaxation
 * banner. The rule and its protective lookups live in misfiled-country.ts
 * (tested exhaustively in geo-misfiled-country.test.ts); these assert the
 * ladder wiring — the rung fires inside mergeFieldHits, threads through
 * buildLocationSuggestions, and stays inert without a gazetteer.
 */

const GAZETTEER = buildGazetteerIndex({
    countries: [
        ["CA", "CAN", "Canada"],
        ["GE", "GEO", "Georgia"],
        ["MX", "MEX", "Mexico"],
    ],
    admin1: [["US", "GA", "Georgia"]],
    cities: [["Mexico", null, 39.17, -91.88, "US", "MO", 11660]],
});

test("a country name is dropped from the CITY group — the row that surfaced this", () => {
    const out = mergeFieldHits(
        "location_city",
        [
            { value: "Toronto", count: 2306 },
            { value: "Canada", count: 31 },
        ],
        LOCATION_SUGGEST_PER_FIELD,
        GAZETTEER,
    );
    assert.deepEqual(out.map((o) => o.label), ["Toronto"]);
});

test("the protective lookups hold through the ladder: Georgia the state and Mexico the city stay", () => {
    assert.deepEqual(
        mergeFieldHits(
            "location_state",
            [
                { value: "Georgia", count: 8148 },
                { value: "Canada", count: 33 },
            ],
            LOCATION_SUGGEST_PER_FIELD,
            GAZETTEER,
        ).map((o) => o.label),
        ["Georgia"],
    );
    assert.deepEqual(
        mergeFieldHits(
            "location_city",
            [{ value: "Mexico", count: 136 }],
            LOCATION_SUGGEST_PER_FIELD,
            GAZETTEER,
        ).map((o) => o.label),
        ["Mexico"],
    );
});

test("the honest COUNTRY row survives, so the broad result stays one click away", () => {
    const groups = buildLocationSuggestions(
        {
            location_city: [{ value: "Canada", count: 31 }],
            location_state: [{ value: "Canada", count: 33 }],
            location_country: [{ value: "Canada", count: 66010 }],
        },
        LOCATION_SUGGEST_PER_FIELD,
        GAZETTEER,
    );
    // The two trap groups dissolve entirely (no empty groups), the honest
    // one renders — the dropdown now has exactly one "Canada", the one that
    // delivers.
    assert.deepEqual(groups.map((g) => g.field), ["location_country"]);
    assert.deepEqual(groups[0]!.items.map((i) => i.label), ["Canada"]);
});

test("without a gazetteer the rung is inert — absence of knowledge never suppresses", () => {
    const out = mergeFieldHits("location_city", [{ value: "Canada", count: 31 }]);
    assert.deepEqual(out.map((o) => o.label), ["Canada"]);
});

test("prioritizeCountryMatch: exact query 'Canada' puts the country group first and ahead of city collisions", () => {
    const groups: LocationSuggestGroup[] = buildLocationSuggestions(
        {
            location_city: [
                { value: "Canandaigua", count: 120 },
                { value: "Canada-Mississauga", count: 90 },
            ],
            location_country: [{ value: "Canada", count: 77399 }],
        },
        LOCATION_SUGGEST_PER_FIELD,
        GAZETTEER,
    );
    const out = prioritizeCountryMatch(groups, "Canada");
    assert.deepEqual(out.map((g) => g.field), ["location_country", "location_city"]);
    assert.equal(out[0]!.items[0]!.label, "Canada");
    assert.equal(out[0]!.items[0]!.field, "location_country");
});

test("prioritizeCountryMatch: no reorder when the query is not an exact country match", () => {
    const groups: LocationSuggestGroup[] = buildLocationSuggestions({
        location_city: [{ value: "Canandaigua", count: 120 }],
        location_country: [{ value: "Canada", count: 77399 }],
    });
    const out = prioritizeCountryMatch(groups, "Can");
    assert.deepEqual(out.map((g) => g.field), groups.map((g) => g.field));
});

test("countryCommitFieldForQuery: exact 'Canada' resolves to location_country for free-text commit", () => {
    const groups: LocationSuggestGroup[] = [
        {
            field: "location_country",
            heading: "Countries",
            items: [{ key: "location_country:canada", label: "Canada", field: "location_country", count: 77399 }],
        },
    ];
    assert.equal(countryCommitFieldForQuery(groups, "canada"), "location_country");
    assert.equal(countryCommitFieldForQuery(groups, "Canandaigua"), undefined);
});

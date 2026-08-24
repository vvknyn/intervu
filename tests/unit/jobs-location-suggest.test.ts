import { test } from "node:test";
import assert from "node:assert/strict";

import {
    mergeFieldHits,
    buildLocationSuggestions,
    isLocationSelected,
    addLocationValue,
    removeLocationValue,
    LOCATION_SUGGEST_PER_FIELD,
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

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    applyLocationSheetDraft,
    locationTriggerLabel,
    PRISTINE_FILTER_STATE,
} from "../../src/components/jobs/FilterPanel";
import { extraChosenPlaces, initLocationSheetDraft } from "../../src/components/jobs/LocationPickerSheet";

test("applyLocationSheetDraft: detected clears explicit country", () => {
    const state = {
        ...PRISTINE_FILTER_STATE,
        facets: { location_country: ["Canada"] },
    };
    const next = applyLocationSheetDraft(
        { useDetected: true, places: ["Canada"], otherText: "", showOther: false, remote: false },
        state,
        "remote",
    );
    assert.equal(next.facets.location_country, undefined);
});

// Was "other text WINS over popular country" — under the single-value draft,
// typing a city discarded the country you had already tapped. The sheet's own
// copy says "Pick one or more", so free text is now one MORE place.
test("applyLocationSheetDraft: other text is added alongside the chosen countries, not instead of them", () => {
    const next = applyLocationSheetDraft(
        {
            useDetected: false,
            places: ["Canada"],
            otherText: "Toronto",
            showOther: true,
            remote: false,
        },
        PRISTINE_FILTER_STATE,
        undefined,
    );
    assert.deepEqual(next.facets.location_country, ["Canada", "Toronto"]);
});

test("applyLocationSheetDraft: commits every chosen place, not the first one", () => {
    const next = applyLocationSheetDraft(
        {
            useDetected: false,
            places: ["Canada", "United States", "Berlin"],
            otherText: "",
            showOther: false,
            remote: false,
        },
        PRISTINE_FILTER_STATE,
        undefined,
    );
    assert.deepEqual(next.facets.location_country, ["Canada", "United States", "Berlin"]);
});

// A case OTHER than the one that surfaced the bug: the sheet goes through the
// same folded compare as the desktop picker, so the accent-split that makes
// `location_city = "Montreal"` and `"Montréal"` disjoint on the index cannot
// come back as two chips for one city.
test("applyLocationSheetDraft: free text already chosen under another spelling is not added twice", () => {
    const next = applyLocationSheetDraft(
        {
            useDetected: false,
            places: ["Montréal"],
            otherText: "montreal",
            showOther: true,
            remote: false,
        },
        PRISTINE_FILTER_STATE,
        undefined,
    );
    assert.deepEqual(next.facets.location_country, ["Montréal"]);
});

test("applyLocationSheetDraft: turning every place off clears the facet rather than filtering on nothing", () => {
    const next = applyLocationSheetDraft(
        { useDetected: false, places: [], otherText: "", showOther: false, remote: false },
        { ...PRISTINE_FILTER_STATE, facets: { location_country: ["Canada", "India"] } },
        undefined,
    );
    assert.equal(next.facets.location_country, undefined);
});

test("applyLocationSheetDraft: toggles remote facet value generically", () => {
    const next = applyLocationSheetDraft(
        { useDetected: false, places: [], otherText: "", showOther: false, remote: true },
        PRISTINE_FILTER_STATE,
        "Remote (US)",
    );
    assert.deepEqual(next.facets.work_type, ["Remote (US)"]);
});

test("locationTriggerLabel: an explicit committed country wins", () => {
    const label = locationTriggerLabel({ ...PRISTINE_FILTER_STATE, facets: { location_country: ["Germany"] } });
    assert.equal(label, "Germany");
});

// Item 7e (2026-08-21 front-door audit) objected to this field showing "Near
// Canada" for two independent reasons: the prefill was PASSIVE (nothing
// marked it as a guess, so it read as an explicit choice the searcher never
// made), and a country is not a locality this field's own placeholder
// promises. 2026-09-10 ("auto location detect is not working" — the
// disclosure was missing entirely on the pristine mobile landing)
// reintroduces the default into this same function, but only ever as an
// explicitly-labeled "Near {region} (detected)" (see location-label.ts's
// doc comment for which objection this closes and which it knowingly
// doesn't) — never a bare "Near {Country}" indistinguishable from a typed
// value. With no default to show at all, the fallback is still the plain
// placeholder.
test("locationTriggerLabel: falls back to the plain placeholder with no explicit country and no detected default", () => {
    assert.equal(locationTriggerLabel(PRISTINE_FILTER_STATE), "City, state, or remote");
});

test("locationTriggerLabel: an explicit committed country still wins over a detected default — never shows 'detected' once the searcher has chosen", () => {
    const label = locationTriggerLabel(
        { ...PRISTINE_FILTER_STATE, facets: { location_country: ["Germany"] } },
        "US",
    );
    assert.equal(label, "Germany");
});

test("initLocationSheetDraft: marks detected when default is active and no explicit location", () => {
    const draft = initLocationSheetDraft(PRISTINE_FILTER_STATE, {
        defaultedIso2: "US",
        locationDefaultSuppressed: false,
        remoteValue: "remote",
    });
    assert.equal(draft.useDetected, true);
    assert.equal(draft.remote, false);
});

test("initLocationSheetDraft: seeds EVERY committed place, so the sheet opens showing the whole filter", () => {
    const draft = initLocationSheetDraft(
        { ...PRISTINE_FILTER_STATE, facets: { location_country: ["Canada", "Toronto", " Berlin "] } },
        { defaultedIso2: "US", locationDefaultSuppressed: false, remoteValue: "remote" },
    );
    assert.deepEqual(draft.places, ["Canada", "Toronto", "Berlin"]);
    // An explicit filter beats the IP default, however many places it holds.
    assert.equal(draft.useDetected, false);
});

test("extraChosenPlaces: only places with no popular row of their own, folded", () => {
    assert.deepEqual(
        extraChosenPlaces(["Canada", "Toronto", "united states", "Montréal"]),
        ["Toronto", "Montréal"],
    );
});

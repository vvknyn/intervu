import { test } from "node:test";
import assert from "node:assert/strict";
import {
    applyLocationSheetDraft,
    locationTriggerLabel,
    PRISTINE_FILTER_STATE,
} from "../../src/components/jobs/FilterPanel";
import { initLocationSheetDraft } from "../../src/components/jobs/LocationPickerSheet";

test("applyLocationSheetDraft: detected clears explicit country", () => {
    const state = {
        ...PRISTINE_FILTER_STATE,
        facets: { location_country: ["Canada"] },
    };
    const next = applyLocationSheetDraft(
        { useDetected: true, country: null, otherText: "", showOther: false, remote: false },
        state,
        "remote",
    );
    assert.equal(next.facets.location_country, undefined);
});

test("applyLocationSheetDraft: other text wins over popular country", () => {
    const next = applyLocationSheetDraft(
        {
            useDetected: false,
            country: "Canada",
            otherText: "Toronto",
            showOther: true,
            remote: false,
        },
        PRISTINE_FILTER_STATE,
        undefined,
    );
    assert.deepEqual(next.facets.location_country, ["Toronto"]);
});

test("applyLocationSheetDraft: toggles remote facet value generically", () => {
    const next = applyLocationSheetDraft(
        { useDetected: false, country: null, otherText: "", showOther: false, remote: true },
        PRISTINE_FILTER_STATE,
        "Remote (US)",
    );
    assert.deepEqual(next.facets.work_type, ["Remote (US)"]);
});

test("locationTriggerLabel: an explicit committed country wins", () => {
    const label = locationTriggerLabel({ ...PRISTINE_FILTER_STATE, facets: { location_country: ["Germany"] } });
    assert.equal(label, "Germany");
});

// Item 7e (2026-08-21 front-door audit): live prod prefilled "Near Canada"
// into this field from the IP-geo default alone — a country is not a
// locality, and this field's own placeholder promises "City, state, or
// remote". `locationTriggerLabel` no longer takes a detected-default input
// at all, so there is nothing left that CAN synthesize a "Near {Country}"
// label — this pins the empty-input fallback rather than a specific detected
// value, since the function's signature itself now makes the old bug
// unreachable.
test("locationTriggerLabel: falls back to the plain placeholder with no explicit country — never synthesizes one from a country-level default", () => {
    assert.equal(locationTriggerLabel(PRISTINE_FILTER_STATE), "City, state, or remote");
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

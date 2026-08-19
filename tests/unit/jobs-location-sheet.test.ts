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

test("locationTriggerLabel: prefers explicit country over detected default", () => {
    const label = locationTriggerLabel(
        { ...PRISTINE_FILTER_STATE, facets: { location_country: ["Germany"] } },
        { defaultedIso2: "CA", locationDefaultSuppressed: false, detectedName: "Canada" },
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

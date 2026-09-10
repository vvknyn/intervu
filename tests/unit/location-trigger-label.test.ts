import { test } from "node:test";
import assert from "node:assert/strict";
import { locationTriggerLabel, LOCATION_TRIGGER_PLACEHOLDER } from "../../src/lib/jobs/location-label";
import { shouldShowLocationDefaultChip } from "../../src/lib/jobs/location-default-preference";
import { LOCATION_FACET_FIELDS } from "../../src/lib/jobs/meilisearch";
import { PRISTINE_FILTER_STATE, type FilterState } from "../../src/components/jobs/FilterPanel";

// Bug: "auto location detect is not working" (2026-09-10). The IP-geo
// default (`result.defaultedLocation`) was applying correctly on the
// server, but the ONE always-visible disclosure surface on a pristine
// mobile landing — this trigger's own text — never read it, so a fresh
// visitor saw the generic placeholder and concluded detection had failed.
// `locationTriggerLabel` is now the single chokepoint: every state that
// used to guard the old chip behind `showToolbarFilters` is covered by
// construction because this function is the visible button text in every
// state, mobile and desktop alike.

test("locationTriggerLabel: no explicit selection + a detected default discloses it", () => {
    const label = locationTriggerLabel(PRISTINE_FILTER_STATE, "CA");
    assert.match(label, /Near Canada/);
    assert.match(label, /detected/);
});

test("locationTriggerLabel: an explicit place always wins — never shows 'detected'", () => {
    const state: FilterState = { ...PRISTINE_FILTER_STATE, facets: { location_country: ["Berlin"] } };
    const label = locationTriggerLabel(state, "CA");
    assert.equal(label, "Berlin");
    assert.doesNotMatch(label, /detected/);
});

test("locationTriggerLabel: no selection and no detected default falls back to the placeholder", () => {
    assert.equal(locationTriggerLabel(PRISTINE_FILTER_STATE, null), LOCATION_TRIGGER_PLACEHOLDER);
    assert.equal(locationTriggerLabel(PRISTINE_FILTER_STATE, undefined), LOCATION_TRIGGER_PLACEHOLDER);
});

// A class case different from the one that surfaced the bug: remote-only is
// also an explicit choice made through the SAME location sheet
// (`applyLocationSheetDraft`'s `remote` field), not a place. With no default
// active there's nothing to disclose, so this is still bare "Remote".
test("locationTriggerLabel: remote-only selection with no active default is bare 'Remote'", () => {
    const state: FilterState = { ...PRISTINE_FILTER_STATE, facets: { work_type: ["Remote (US)"] } };
    const label = locationTriggerLabel(state, null);
    assert.equal(label, "Remote");
});

// PR #461 review BLOCKER: a remote-only pick does NOT suppress the geo
// default server-side — `hasLocationSignal` (lib/geo/ip-default.ts) never
// checks `work_type`, and `buildFilter` (lib/jobs/meilisearch.ts) ANDs the
// `work_type = remote` clause with the detected country's `places` clause,
// so results really are still geo-scoped to the detected country. The
// trigger must disclose that rather than silently dropping it, so "Remote"
// and "(detected)" combine instead of one hiding the other.
test("locationTriggerLabel: remote-only selection with an active default discloses both", () => {
    const state: FilterState = { ...PRISTINE_FILTER_STATE, facets: { work_type: ["Remote (US)"] } };
    const label = locationTriggerLabel(state, "CA");
    assert.match(label, /Remote/);
    assert.match(label, /Near Canada \(detected\)/);
});

// Table-driven agreement check (PR #461 review BLOCKER): the toolbar's
// DefaultLocationChip and this trigger used to each keep their own "is the
// default still in effect" check and could disagree — e.g. a remote-only
// pick suppressed "detected" in the trigger while the chip kept showing.
// `locationTriggerLabel` now calls the exact same `shouldShowLocationDefaultChip`
// predicate the chip's gate uses, so the two can never diverge again. This
// pins agreement across every row the review named.
test("locationTriggerLabel and shouldShowLocationDefaultChip agree on every state", () => {
    const rows: Array<{
        name: string;
        state: FilterState;
        defaultedLocation: string | null;
        expectDefaultShown: boolean;
    }> = [
        {
            name: "remote chosen + default active",
            state: { ...PRISTINE_FILTER_STATE, facets: { work_type: ["Remote (US)"] } },
            defaultedLocation: "CA",
            expectDefaultShown: true,
        },
        {
            name: "explicit location chosen + default active",
            state: { ...PRISTINE_FILTER_STATE, facets: { location_country: ["Germany"] } },
            defaultedLocation: "CA",
            expectDefaultShown: false,
        },
        {
            name: "pristine (no selection) + default active",
            state: PRISTINE_FILTER_STATE,
            defaultedLocation: "CA",
            expectDefaultShown: true,
        },
        {
            name: "pristine (no selection), no default",
            state: PRISTINE_FILTER_STATE,
            defaultedLocation: null,
            expectDefaultShown: false,
        },
    ];

    for (const row of rows) {
        const chosenLocations = LOCATION_FACET_FIELDS.flatMap((field) => row.state.facets[field] ?? []);
        const chipShows = shouldShowLocationDefaultChip(row.defaultedLocation, chosenLocations);
        const labelShowsDetected = /detected/.test(locationTriggerLabel(row.state, row.defaultedLocation));

        assert.equal(chipShows, row.expectDefaultShown, `${row.name}: chip predicate`);
        assert.equal(labelShowsDetected, row.expectDefaultShown, `${row.name}: trigger label`);
        assert.equal(chipShows, labelShowsDetected, `${row.name}: chip and trigger must agree`);
    }
});

// `resolveLocationDefault` (lib/geo/ip-default.ts) only ever resolves to a
// country-level ISO2 today — there is no city-level geo signal anywhere in
// this codebase (confirmed by reading it directly for this fix) — so there
// is no city-level `defaultedLocation` value to construct a fifth case from.
// If that changes, `regionDisplayName` (the same formatter the sheet's
// "detected" copy and `DefaultLocationChip` already use) is the one place
// that would need to grow city-level support, and this file the one place
// that would need a case for it.

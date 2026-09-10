import { test } from "node:test";
import assert from "node:assert/strict";
import { locationTriggerLabel, LOCATION_TRIGGER_PLACEHOLDER } from "../../src/lib/jobs/location-label";
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
// (`applyLocationSheetDraft`'s `remote` field), not a place — a naive
// "nothing in location_country means nothing chosen" fix would leak the IP
// default on top of it.
test("locationTriggerLabel: remote-only selection always wins — never shows 'detected'", () => {
    const state: FilterState = { ...PRISTINE_FILTER_STATE, facets: { work_type: ["Remote (US)"] } };
    const label = locationTriggerLabel(state, "CA");
    assert.match(label, /Remote/);
    assert.doesNotMatch(label, /detected/);
});

// `resolveLocationDefault` (lib/geo/ip-default.ts) only ever resolves to a
// country-level ISO2 today — there is no city-level geo signal anywhere in
// this codebase (confirmed by reading it directly for this fix) — so there
// is no city-level `defaultedLocation` value to construct a fifth case from.
// If that changes, `regionDisplayName` (the same formatter the sheet's
// "detected" copy and `DefaultLocationChip` already use) is the one place
// that would need to grow city-level support, and this file the one place
// that would need a case for it.

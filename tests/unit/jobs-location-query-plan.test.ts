import { test } from "node:test";
import assert from "node:assert/strict";
import {
    applyLabelPrefix,
    buildWorkModeSuggestion,
    planLocationQuery,
    type LocationSuggestGroup,
} from "../../src/lib/jobs/location-suggest";
import { parseWorkTypeTokens } from "../../src/lib/jobs/query-understanding";

/**
 * The location picker's work-mode split.
 *
 * Measured on the live index 2026-08-24: typing "remote can" offered
 * "Remote – Canada & United States" with a count of ONE — a junk string an
 * employer typed into their own location field — while remote-in-Canada is
 * 6,097. The searcher picks the plausible row and gets nothing.
 */

test("splits a work mode off the place and binds it as a filter", () => {
    const plan = planLocationQuery("remote can");
    assert.equal(plan.facetQuery, "can");
    assert.equal(plan.filter, '(work_type = "remote")');
    assert.equal(plan.labelPrefix, "Remote ");
});

// A case OTHER than the one that surfaced this: hybrid, and a multi-word place.
test("works for any work mode, not just remote, and keeps multi-word places intact", () => {
    const plan = planLocationQuery("hybrid new york");
    assert.equal(plan.facetQuery, "new york");
    assert.equal(plan.filter, '(work_type = "hybrid")');
    assert.equal(plan.labelPrefix, "Hybrid ");
});

test("recognizes the phrase spellings the query box already understands", () => {
    // "work from home" and "on-site" are the same vocabulary as the search
    // box, because both sides call parseWorkTypeTokens.
    assert.equal(planLocationQuery("work from home berlin").filter, '(work_type = "remote")');
    assert.equal(planLocationQuery("on-site berlin").filter, '(work_type = "onsite")');
});

test("a plain place is untouched — no filter, no prefix, byte-for-byte the old behaviour", () => {
    const plan = planLocationQuery("  toronto ");
    assert.equal(plan.facetQuery, "toronto");
    assert.equal(plan.filter, undefined);
    assert.equal(plan.labelPrefix, "");
});

test("a BARE work mode has no place to facet-search, so the plan carries the mode itself", () => {
    // Measured live: searching the literal word "remote" against place NAMES
    // only turns up corpus junk that merely contains it ("Remote Only",
    // count 1) — see the module doc. There is no residual place text at all,
    // so the plan must not hand a place facet-search anything to search for.
    const plan = planLocationQuery("remote");
    assert.equal(plan.facetQuery, "");
    assert.equal(plan.filter, undefined);
    assert.equal(plan.labelPrefix, "");
    assert.deepEqual(plan.workModeOnly, ["remote"]);
});

// A case OTHER than the one that surfaced the bug: hybrid, not remote.
test("a bare NON-remote work mode gets the same treatment", () => {
    const plan = planLocationQuery("hybrid");
    assert.deepEqual(plan.workModeOnly, ["hybrid"]);
    assert.equal(plan.facetQuery, "");
});

test("the existing 'work mode + place' behaviour is unchanged by the bare-mode split", () => {
    const plan = planLocationQuery("remote can");
    assert.equal(plan.facetQuery, "can");
    assert.equal(plan.filter, '(work_type = "remote")');
    assert.equal(plan.labelPrefix, "Remote ");
    assert.equal(plan.workModeOnly, undefined);
});

test("buildWorkModeSuggestion sums the corpus's own count for the mode, honestly measured", () => {
    const group = buildWorkModeSuggestion(["remote"], [
        { value: "remote", count: 45230 },
        { value: "hybrid", count: 9120 },
        { value: "onsite", count: 3011 },
    ]);
    assert.ok(group);
    assert.equal(group.field, "work_type");
    assert.equal(group.items.length, 1);
    assert.equal(group.items[0]!.label, "Remote — anywhere");
    assert.equal(group.items[0]!.field, "work_type");
    assert.equal(group.items[0]!.count, 45230);
});

// A case OTHER than remote: onsite, plus a multi-mode query summed correctly.
test("buildWorkModeSuggestion works for any mode and sums a multi-mode query", () => {
    const onsite = buildWorkModeSuggestion(["onsite"], [{ value: "onsite", count: 812 }]);
    assert.ok(onsite);
    assert.equal(onsite.items[0]!.label, "Onsite — anywhere");
    assert.equal(onsite.items[0]!.count, 812);

    const both = buildWorkModeSuggestion(["remote", "hybrid"], [
        { value: "remote", count: 45230 },
        { value: "hybrid", count: 9120 },
    ]);
    assert.ok(both);
    assert.equal(both.items[0]!.label, "Remote Hybrid — anywhere");
    assert.equal(both.items[0]!.count, 45230 + 9120);
});

test("buildWorkModeSuggestion omits rather than shows a wrong count when the facet couldn't be asked", () => {
    assert.equal(buildWorkModeSuggestion(["remote"], null), null);
});

test("buildWorkModeSuggestion omits when the corpus has no hit for the requested mode", () => {
    assert.equal(buildWorkModeSuggestion(["remote"], [{ value: "hybrid", count: 100 }]), null);
});

test("the committed label round-trips back through the SAME parser", () => {
    // This is the whole reason the mode rides on `label`: the picker and
    // typing it by hand must produce identical filter state.
    const plan = planLocationQuery("remote can");
    const committed = `${plan.labelPrefix}Canada`;
    assert.equal(committed, "Remote Canada");
    const round = parseWorkTypeTokens(committed);
    assert.equal(round.residualQ, "Canada");
    assert.deepEqual(round.workTypes, ["remote"]);
});

test("applyLabelPrefix prefixes label AND key, so a place and its qualified form never collide", () => {
    const groups: LocationSuggestGroup[] = [
        {
            field: "location_country",
            heading: "Countries",
            items: [{ key: "location_country:canada", label: "Canada", field: "location_country", count: 6097 }],
        },
    ];
    const out = applyLabelPrefix(groups, "Remote ");
    assert.equal(out[0]!.items[0]!.label, "Remote Canada");
    assert.equal(out[0]!.items[0]!.key, "Remote location_country:canada");
    // The count is passed through untouched — it came from a FILTERED facet
    // search, so it is the real intersection, not the place's total.
    assert.equal(out[0]!.items[0]!.count, 6097);
});

test("applyLabelPrefix with no prefix returns the groups unchanged", () => {
    const groups: LocationSuggestGroup[] = [
        { field: "location_city", heading: "Cities", items: [{ key: "k", label: "Toronto", field: "location_city", count: 5 }] },
    ];
    assert.equal(applyLabelPrefix(groups, ""), groups);
});

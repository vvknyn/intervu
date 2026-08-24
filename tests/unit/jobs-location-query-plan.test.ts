import { test } from "node:test";
import assert from "node:assert/strict";
import {
    applyLabelPrefix,
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

test("a BARE work mode keeps the old behaviour rather than inventing a ranking", () => {
    // What to show for "remote" with no place is a product question, and the
    // toolbar already carries a global Work mode control. Guard the decision
    // so it is not silently changed.
    const plan = planLocationQuery("remote");
    assert.equal(plan.facetQuery, "remote");
    assert.equal(plan.filter, undefined);
    assert.equal(plan.labelPrefix, "");
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

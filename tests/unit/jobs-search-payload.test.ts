import { test } from "node:test";
import assert from "node:assert/strict";
import { buildJobSearchPayload } from "../../src/lib/jobs/search-payload";
import { PRISTINE_FILTER_STATE, type FilterState } from "../../src/components/jobs/FilterPanel";

// Review fix (2026-07-19): the ONE place page.tsx's live search, ghost-count
// probe, and mobile sheet live count all build their `searchJobsAction`
// payload from — was three hand-rolled copies before this existed.

test("empty/whitespace query becomes undefined, not an empty string", () => {
    assert.equal(buildJobSearchPayload(PRISTINE_FILTER_STATE, "", "newest").q, undefined);
    assert.equal(buildJobSearchPayload(PRISTINE_FILTER_STATE, "   ", "newest").q, undefined);
});

test("a real query is trimmed and passed through", () => {
    assert.equal(buildJobSearchPayload(PRISTINE_FILTER_STATE, "  engineer  ", "newest").q, "engineer");
});

test("zero salaryMin and false visaOnly become undefined (not sent as filters)", () => {
    const p = buildJobSearchPayload(PRISTINE_FILTER_STATE, "", "newest");
    assert.equal(p.salaryMin, undefined);
    assert.equal(p.visaOnly, undefined);
});

test("a nonzero salaryMin and true visaOnly pass through", () => {
    const state: FilterState = { ...PRISTINE_FILTER_STATE, salaryMin: 100_000, visaOnly: true };
    const p = buildJobSearchPayload(state, "", "newest");
    assert.equal(p.salaryMin, 100_000);
    assert.equal(p.visaOnly, true);
});

test("facets, postedBucket, and hideGhosts pass through verbatim", () => {
    const state: FilterState = {
        ...PRISTINE_FILTER_STATE,
        facets: { work_type: ["remote"] },
        postedBucket: "7d",
        hideGhosts: false,
    };
    const p = buildJobSearchPayload(state, "", "newest");
    assert.deepEqual(p.facets, { work_type: ["remote"] });
    assert.equal(p.postedBucket, "7d");
    assert.equal(p.hideGhosts, false);
});

test("null/undefined sort becomes undefined; an explicit sort passes through", () => {
    assert.equal(buildJobSearchPayload(PRISTINE_FILTER_STATE, "", null).sort, undefined);
    assert.equal(buildJobSearchPayload(PRISTINE_FILTER_STATE, "", undefined).sort, undefined);
    assert.equal(buildJobSearchPayload(PRISTINE_FILTER_STATE, "", "salary_desc").sort, "salary_desc");
});

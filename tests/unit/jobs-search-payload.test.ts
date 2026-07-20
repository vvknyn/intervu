import { test } from "node:test";
import assert from "node:assert/strict";
import { buildJobSearchPayload } from "../../src/lib/jobs/search-payload";
import { PRISTINE_FILTER_STATE, type FilterState } from "../../src/components/jobs/FilterPanel";

// Review fix (2026-07-19): the ONE place page.tsx's live search, ghost-count
// probe, and mobile sheet live count all build their `searchJobsAction`
// payload from — was three hand-rolled copies before this existed.

test("empty/whitespace query becomes undefined, not an empty string", () => {
    assert.equal(buildJobSearchPayload(PRISTINE_FILTER_STATE, "", "newest", true).q, undefined);
    assert.equal(buildJobSearchPayload(PRISTINE_FILTER_STATE, "   ", "newest", true).q, undefined);
});

test("a real query is trimmed and passed through", () => {
    assert.equal(buildJobSearchPayload(PRISTINE_FILTER_STATE, "  engineer  ", "newest", true).q, "engineer");
});

test("zero salaryMin and false visaOnly become undefined (not sent as filters)", () => {
    const p = buildJobSearchPayload(PRISTINE_FILTER_STATE, "", "newest", true);
    assert.equal(p.salaryMin, undefined);
    assert.equal(p.visaOnly, undefined);
});

test("a nonzero salaryMin and true visaOnly pass through", () => {
    const state: FilterState = { ...PRISTINE_FILTER_STATE, salaryMin: 100_000, visaOnly: true };
    const p = buildJobSearchPayload(state, "", "newest", true);
    assert.equal(p.salaryMin, 100_000);
    assert.equal(p.visaOnly, true);
});

test("facets, postedBucket, and hideGhosts pass through verbatim when date filtering is supported", () => {
    const state: FilterState = {
        ...PRISTINE_FILTER_STATE,
        facets: { work_type: ["remote"] },
        postedBucket: "7d",
        hideGhosts: false,
    };
    const p = buildJobSearchPayload(state, "", "newest", true);
    assert.deepEqual(p.facets, { work_type: ["remote"] });
    assert.equal(p.postedBucket, "7d");
    assert.equal(p.hideGhosts, false);
});

// Phase 1-a #4: a `postedBucket` sitting in state (stale URL/bookmark) must
// never reach the request once the corpus can't back it — `buildFilter`
// (meilisearch.ts) honors it unconditionally, so an ungated request would
// range-filter over an ~unpopulated field and silently 0-result every hit.
test("postedBucket is dropped when the corpus doesn't support date filtering, even if state carries one", () => {
    const state: FilterState = { ...PRISTINE_FILTER_STATE, postedBucket: "7d" };
    const p = buildJobSearchPayload(state, "", "newest", false);
    assert.equal(p.postedBucket, undefined);
});

test("null/undefined sort becomes undefined; an explicit sort passes through", () => {
    assert.equal(buildJobSearchPayload(PRISTINE_FILTER_STATE, "", null, true).sort, undefined);
    assert.equal(buildJobSearchPayload(PRISTINE_FILTER_STATE, "", undefined, true).sort, undefined);
    assert.equal(buildJobSearchPayload(PRISTINE_FILTER_STATE, "", "salary_desc", true).sort, "salary_desc");
});

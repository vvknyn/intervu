import { test } from "node:test";
import assert from "node:assert/strict";
import { buildJobSearchPayload } from "../../src/lib/jobs/search-payload";
import { PRISTINE_FILTER_STATE, type FilterState } from "../../src/components/jobs/FilterPanel";

/** No corpus narrowing — the default both `board` and `companyDomain` unset. */

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

// Phase 1-a #? (30d default): the fresh-visit default now sits IN
// PRISTINE_FILTER_STATE.postedBucket ("30d") rather than being absent, so
// this same gate is what stops it from silently 0-result-ing every visitor
// on a corpus that can't back it — critical, not just the explicit-bucket
// case above.
test("the 30d default passes through when date filtering is supported", () => {
    const p = buildJobSearchPayload(PRISTINE_FILTER_STATE, "", "newest", true);
    assert.equal(p.postedBucket, "30d");
});

test("the 30d default is coerced away (not sent) when date filtering is unsupported", () => {
    const p = buildJobSearchPayload(PRISTINE_FILTER_STATE, "", "newest", false);
    assert.equal(p.postedBucket, undefined);
});

test("null/undefined sort becomes undefined; an explicit sort passes through", () => {
    assert.equal(buildJobSearchPayload(PRISTINE_FILTER_STATE, "", null, true).sort, undefined);
    assert.equal(buildJobSearchPayload(PRISTINE_FILTER_STATE, "", undefined, true).sort, undefined);
    assert.equal(buildJobSearchPayload(PRISTINE_FILTER_STATE, "", "salary_desc", true).sort, "salary_desc");
});

test("board passes through when set; a null board is omitted", () => {
    assert.equal(buildJobSearchPayload({ ...PRISTINE_FILTER_STATE, board: "elite" }, "", "newest", true).board, "elite");
    assert.equal(buildJobSearchPayload(PRISTINE_FILTER_STATE, "", "newest", true).board, undefined);
});

// Employer scope (2026-08-16) rides in `FilterState` beside `board`
// (2026-08-24) — both narrow WHICH corpus is searched rather than filtering
// within it, and both land on the same `company_domain` clause downstream.
// They used to arrive as a separate `scope` argument; that second home is what
// let `board=elite` cap every search with no chip naming it and no clear
// reaching it, because the chips/clears read `FilterState` and it wasn't there.
test("companyDomain passes through when set; a null companyDomain is omitted", () => {
    assert.equal(
        buildJobSearchPayload({ ...PRISTINE_FILTER_STATE, companyDomain: "harrods.com" }, "", "newest", true)
            .companyDomain,
        "harrods.com",
    );
    assert.equal(buildJobSearchPayload(PRISTINE_FILTER_STATE, "", "newest", true).companyDomain, undefined);
});

test("board and companyDomain are carried together — picking up one must not drop the other", () => {
    const p = buildJobSearchPayload(
        { ...PRISTINE_FILTER_STATE, board: "elite", companyDomain: "harrods.com" },
        "",
        "newest",
        true,
    );
    assert.equal(p.board, "elite");
    assert.equal(p.companyDomain, "harrods.com");
});

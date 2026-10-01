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

// Phase 1-a #? (posted default): the pristine "90d" ("30d" until 2026-09-30)
// IS the product default and must be sent — only an explicit "Any date"
// lifts it.
test("the 90d UI default IS sent in the search payload when date filtering is supported", () => {
    const p = buildJobSearchPayload(PRISTINE_FILTER_STATE, "", "newest", true);
    assert.equal(p.postedBucket, "90d");
});

test("explicit 90d (postedExplicit: true) is sent as postedBucket 90d when date filtering is supported", () => {
    const state: FilterState = { ...PRISTINE_FILTER_STATE, postedExplicit: true };
    const p = buildJobSearchPayload(state, "", "newest", true);
    assert.equal(p.postedBucket, "90d");
});

test("a picked 30d window (the old default) is sent as postedBucket 30d", () => {
    const state: FilterState = { ...PRISTINE_FILTER_STATE, postedBucket: "30d", postedExplicit: true };
    assert.equal(buildJobSearchPayload(state, "", "newest", true).postedBucket, "30d");
});

test("explicit 90d is still dropped when date filtering is unsupported", () => {
    const state: FilterState = { ...PRISTINE_FILTER_STATE, postedExplicit: true };
    const p = buildJobSearchPayload(state, "", "newest", false);
    assert.equal(p.postedBucket, undefined);
});

test("non-default posted buckets still pass through when date filtering is supported", () => {
    const state: FilterState = { ...PRISTINE_FILTER_STATE, postedBucket: "7d" };
    const p = buildJobSearchPayload(state, "", "newest", true);
    assert.equal(p.postedBucket, "7d");
});

test("the 90d default is coerced away (not sent) when date filtering is unsupported", () => {
    const p = buildJobSearchPayload(PRISTINE_FILTER_STATE, "", "newest", false);
    assert.equal(p.postedBucket, undefined);
});

// yearsExperience is NOT gated by postedDateSupported (unlike postedBucket
// above) — min_years_experience isn't relative-to-now, so a stale bucket in
// state carries no staleness risk and passes through unconditionally.
test("yearsExperience passes through verbatim regardless of postedDateSupported", () => {
    const state: FilterState = { ...PRISTINE_FILTER_STATE, yearsExperience: "6-10" };
    assert.equal(buildJobSearchPayload(state, "", "newest", true).yearsExperience, "6-10");
    assert.equal(buildJobSearchPayload(state, "", "newest", false).yearsExperience, "6-10");
});

test("yearsExperience is undefined by default (pristine state)", () => {
    assert.equal(buildJobSearchPayload(PRISTINE_FILTER_STATE, "", "newest", true).yearsExperience, undefined);
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

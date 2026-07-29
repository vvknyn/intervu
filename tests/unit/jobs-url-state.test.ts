import { test } from "node:test";
import assert from "node:assert/strict";
import {
    parseJobsUrl, serializeJobsUrl, DEFAULT_URL_STATE, urlSortToMode, withSortCleared,
    shouldResetSortOnQueryChange,
} from "../../src/lib/jobs/url-state";

test("all-defaults serializes to empty string", () => {
    assert.equal(serializeJobsUrl(DEFAULT_URL_STATE), "");
});

test("round-trip identity for a loaded state", () => {
    const s = {
        ...DEFAULT_URL_STATE,
        q: "backend engineer",
        facets: { work_type: ["remote", "hybrid"], location_country: ["US"] },
        salaryMin: 150_000,
        visaOnly: true,
        postedBucket: "7d" as const,
        hideGhosts: false,
        sort: "salary" as const,
        jobId: "dd-4821",
    };
    const url = serializeJobsUrl(s);
    assert.deepEqual(parseJobsUrl(new URLSearchParams(url.slice(1))), s);
});

test("defaults stay out of the URL", () => {
    const url = serializeJobsUrl({ ...DEFAULT_URL_STATE, q: "sre" });
    assert.equal(url, "?q=sre");
});

test("junk params and junk values are dropped", () => {
    const s = parseJobsUrl(new URLSearchParams("bogus=1&sort=zzz&posted=99d&salary=7&work=remote"));
    assert.deepEqual(s, { ...DEFAULT_URL_STATE, facets: { work_type: ["remote"] } });
});

// Product decision: fresh visits default to "30d" instead of unset. Encoding
// (chosen so absence stays the default and "no filter" gets its own,
// distinguishable representation): no `posted` param → the default ("30d");
// `posted=any` → no filter (`undefined`, the pre-existing meaning of
// undefined everywhere `postedBucket` is read); any other recognized bucket
// parses exactly as before (back-compat).
test("absent posted param parses to the 30d default", () => {
    assert.equal(parseJobsUrl(new URLSearchParams("")).postedBucket, "30d");
    assert.equal(parseJobsUrl(new URLSearchParams("q=sre")).postedBucket, "30d");
});

test("posted=any parses to no filter (undefined), not the default", () => {
    assert.equal(parseJobsUrl(new URLSearchParams("posted=any")).postedBucket, undefined);
});

test("back-compat: posted=7d (and other existing buckets) parse unchanged", () => {
    assert.equal(parseJobsUrl(new URLSearchParams("posted=7d")).postedBucket, "7d");
    assert.equal(parseJobsUrl(new URLSearchParams("posted=older")).postedBucket, "older");
});

test("serializeJobsUrl omits posted for the 30d default", () => {
    assert.equal(serializeJobsUrl({ ...DEFAULT_URL_STATE, q: "sre" }), "?q=sre");
});

test("serializeJobsUrl writes posted=any for an explicit no-filter state", () => {
    const url = serializeJobsUrl({ ...DEFAULT_URL_STATE, postedBucket: undefined });
    assert.equal(url, "?posted=any");
});

test("posted=any round-trips through serialize + parse", () => {
    const s = { ...DEFAULT_URL_STATE, postedBucket: undefined };
    assert.deepEqual(parseJobsUrl(new URLSearchParams(serializeJobsUrl(s).slice(1))), s);
});

test("ghosts=show flips the hide default", () => {
    assert.equal(parseJobsUrl(new URLSearchParams("ghosts=show")).hideGhosts, false);
    assert.equal(parseJobsUrl(new URLSearchParams("")).hideGhosts, true);
});

test("urlSortToMode maps salary to salary_desc and passes fit through", () => {
    assert.equal(urlSortToMode("salary"), "salary_desc");
    assert.equal(urlSortToMode("fit"), "fit");
    assert.equal(urlSortToMode("newest"), "newest");
});

// Review fix (2026-07-18): shared transition so "ranked by résumé" can
// never linger, claimed by the URL, once the chip is dismissed. (Explore
// taking over the query used to share this too — it no longer does: Explore
// is ephemeral, non-URL state as of the 2026-07-21 design decision, see
// `activateExplore`'s doc comment in src/app/page.tsx.)
test("withSortCleared strips sort while preserving every other field", () => {
    const s = {
        ...DEFAULT_URL_STATE,
        q: "staff engineer",
        facets: { work_type: ["remote"] },
        salaryMin: 100_000,
        visaOnly: true,
        postedBucket: "7d" as const,
        hideGhosts: false,
        sort: "fit" as const,
        jobId: "abc-123",
    };
    assert.deepEqual(withSortCleared(s), { ...s, sort: null });
});

test("withSortCleared is a no-op when sort is already null", () => {
    assert.deepEqual(withSortCleared(DEFAULT_URL_STATE), DEFAULT_URL_STATE);
});

// Phase 1-a #3: the class-fix for the observed first-search wrong-order bug
// — a query changing to a genuinely different, non-empty value always resets
// an explicit sort back to auto (Best match), regardless of which sort was
// active or why.
test("shouldResetSortOnQueryChange resets for a changed non-empty query, any override", () => {
    assert.equal(shouldResetSortOnQueryChange("", "engineer", "newest"), true);
    assert.equal(shouldResetSortOnQueryChange("designer", "engineer", "salary_desc"), true);
    assert.equal(shouldResetSortOnQueryChange("designer", "engineer", "relevance"), true);
});

test("shouldResetSortOnQueryChange is a no-op when there is no override to reset", () => {
    assert.equal(shouldResetSortOnQueryChange("", "engineer", null), false);
});

test("shouldResetSortOnQueryChange never resets for an unchanged query (filter-only changes)", () => {
    assert.equal(shouldResetSortOnQueryChange("engineer", "engineer", "salary_desc"), false);
    assert.equal(shouldResetSortOnQueryChange("  engineer  ", "engineer", "salary_desc"), false);
});

test("shouldResetSortOnQueryChange: emptying the query only resets a 'relevance' override, not others", () => {
    assert.equal(shouldResetSortOnQueryChange("engineer", "", "relevance"), true);
    assert.equal(shouldResetSortOnQueryChange("engineer", "  ", "relevance"), true);
    assert.equal(shouldResetSortOnQueryChange("engineer", "", "salary_desc"), false);
    assert.equal(shouldResetSortOnQueryChange("engineer", "", "newest"), false);
});

test("board=elite round-trips through serialize + parse", () => {
    const url = serializeJobsUrl({ ...DEFAULT_URL_STATE, board: "elite" });
    const params = new URLSearchParams(url.startsWith("?") ? url.slice(1) : url);
    assert.equal(params.get("board"), "elite");
    assert.equal(parseJobsUrl(params).board, "elite");
});

test("unknown board param is dropped", () => {
    assert.equal(parseJobsUrl(new URLSearchParams("board=nope")).board, null);
});

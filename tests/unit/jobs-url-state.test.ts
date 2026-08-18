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

// Approved product change (2026-08-13): an explicitly chosen sort is now
// STICKY across query text edits — a new, different non-empty query no
// longer resets it back to auto. This locks the new contract (superseding
// the old Phase 1-a #3 "any changed query resets" behavior this same suite
// used to assert).
test("shouldResetSortOnQueryChange never resets for a changed non-empty query — sort is sticky across edits", () => {
    assert.equal(shouldResetSortOnQueryChange("engineer", "newest"), false);
    assert.equal(shouldResetSortOnQueryChange("engineer", "salary_desc"), false);
    assert.equal(shouldResetSortOnQueryChange("engineer", "relevance"), false);
});

test("shouldResetSortOnQueryChange is a no-op when there is no override to reset", () => {
    assert.equal(shouldResetSortOnQueryChange("engineer", null), false);
    assert.equal(shouldResetSortOnQueryChange("", null), false);
});

test("shouldResetSortOnQueryChange: an empty query only resets a 'relevance' override, not others — relevance is meaningless without a query", () => {
    assert.equal(shouldResetSortOnQueryChange("", "relevance"), true);
    assert.equal(shouldResetSortOnQueryChange("  ", "relevance"), true);
    assert.equal(shouldResetSortOnQueryChange("", "salary_desc"), false);
    assert.equal(shouldResetSortOnQueryChange("", "newest"), false);
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

// Employer scope (2026-08-16). `/co/[slug]`'s CTA had no way to say "this
// employer" and fell back to a free-text `q=<name>`; the URL grammar now
// carries the `company_domain` the index actually keys on.
test("company scope round-trips as ?company=<domain>", () => {
    const s = { ...DEFAULT_URL_STATE, companyDomain: "harrods.com" };
    assert.equal(serializeJobsUrl(s), "?company=harrods.com");
    assert.deepEqual(parseJobsUrl(new URLSearchParams("company=harrods.com")), s);
});

test("no company scope stays out of the URL entirely", () => {
    assert.equal(serializeJobsUrl(DEFAULT_URL_STATE), "");
    assert.equal(parseJobsUrl(new URLSearchParams("")).companyDomain, null);
});

// One scope, one URL: the filter compares `company_domain` lower-cased
// (meilisearch.ts), so two casings must not become two distinct `searchKey`s
// that refetch the identical result set.
test("a company domain is canonicalized to lower/trimmed, and blank means no scope", () => {
    assert.equal(parseJobsUrl(new URLSearchParams("company=Harrods.COM")).companyDomain, "harrods.com");
    assert.equal(parseJobsUrl(new URLSearchParams("company=%20%20")).companyDomain, null);
});

test("company scope composes with a query and survives the round-trip alongside it", () => {
    const s = { ...DEFAULT_URL_STATE, q: "driver", companyDomain: "harrods.com" };
    assert.deepEqual(parseJobsUrl(new URLSearchParams(serializeJobsUrl(s).slice(1))), s);
});

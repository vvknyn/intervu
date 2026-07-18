import { test } from "node:test";
import assert from "node:assert/strict";
import {
    parseJobsUrl, serializeJobsUrl, DEFAULT_URL_STATE, urlSortToMode, withSortCleared,
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

test("ghosts=show flips the hide default", () => {
    assert.equal(parseJobsUrl(new URLSearchParams("ghosts=show")).hideGhosts, false);
    assert.equal(parseJobsUrl(new URLSearchParams("")).hideGhosts, true);
});

test("urlSortToMode maps salary to salary_desc and passes fit through", () => {
    assert.equal(urlSortToMode("salary"), "salary_desc");
    assert.equal(urlSortToMode("fit"), "fit");
    assert.equal(urlSortToMode("newest"), "newest");
});

// Review fix (2026-07-18): shared by `clearFit` (chip dismiss) and
// `activateExplore` (Explore taking over the query) so "ranked by résumé"
// can never linger, claimed by the URL, once something else owns the query.
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

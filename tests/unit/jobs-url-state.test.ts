import { test } from "node:test";
import assert from "node:assert/strict";
import {
    parseJobsUrl, serializeJobsUrl, DEFAULT_URL_STATE, urlSortToMode,
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
        postedExplicit: true,
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
    const s = parseJobsUrl(new URLSearchParams("bogus=1&sort=zzz&posted=99d&salary=7&work=remote&view=nope"));
    assert.deepEqual(s, { ...DEFAULT_URL_STATE, facets: { work_type: ["remote"] } });
});

test("every salary preset and a custom floor round-trip through the URL", () => {
    // $30k+ and $75k+ used to fall off (only 50k/100k/150k/200k parsed), and
    // so did any custom minimum.
    for (const [salaryMin, param] of [
        [30_000, "30k"], [50_000, "50k"], [75_000, "75k"], [100_000, "100k"],
        [150_000, "150k"], [200_000, "200k"], [65_000, "65k"], [65_500, "65500"],
    ] as const) {
        const s = { ...DEFAULT_URL_STATE, q: "sre", salaryMin };
        const url = serializeJobsUrl(s);
        assert.equal(new URLSearchParams(url.slice(1)).get("salary"), param);
        assert.deepEqual(parseJobsUrl(new URLSearchParams(url.slice(1))), s);
    }
});

test("out-of-range salary floors stay out of the URL and are dropped when read", () => {
    for (const salaryMin of [1, 999, 1_000_001]) {
        assert.equal(serializeJobsUrl({ ...DEFAULT_URL_STATE, q: "sre", salaryMin }), "?q=sre");
    }
    for (const raw of ["7", "0k", "999", "1001k", "75kk", "-75k", "75.5k", "abc"]) {
        assert.equal(parseJobsUrl(new URLSearchParams(`salary=${raw}`)).salaryMin, 0, raw);
    }
    assert.equal(parseJobsUrl(new URLSearchParams("salary=75K")).salaryMin, 75_000);
});

test("view=for-you and view=search round-trip when explicit", () => {
    for (const view of ["for-you", "search"] as const) {
        const s = { ...DEFAULT_URL_STATE, homeView: view };
        assert.deepEqual(parseJobsUrl(new URLSearchParams(serializeJobsUrl(s).slice(1))), s);
    }
});

test("default homeView stays out of the URL", () => {
    assert.equal(serializeJobsUrl(DEFAULT_URL_STATE), "");
    assert.equal(parseJobsUrl(new URLSearchParams("")).homeView, null);
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
    assert.equal(parseJobsUrl(new URLSearchParams("posted=any")).postedExplicit, true);
});

test("back-compat: posted=7d (and other existing buckets) parse unchanged", () => {
    assert.equal(parseJobsUrl(new URLSearchParams("posted=7d")).postedBucket, "7d");
    assert.equal(parseJobsUrl(new URLSearchParams("posted=7d")).postedExplicit, true);
    assert.equal(parseJobsUrl(new URLSearchParams("posted=older")).postedBucket, "older");
});

test("posted=30d parses to explicit 30d default", () => {
    assert.deepEqual(parseJobsUrl(new URLSearchParams("posted=30d")), {
        ...DEFAULT_URL_STATE,
        facets: {},
        postedExplicit: true,
    });
});

test("serializeJobsUrl writes posted=30d for explicit 30d", () => {
    const url = serializeJobsUrl({ ...DEFAULT_URL_STATE, postedExplicit: true });
    assert.equal(url, "?posted=30d");
});

test("explicit posted=30d round-trips through serialize + parse", () => {
    const s = { ...DEFAULT_URL_STATE, postedExplicit: true };
    assert.deepEqual(parseJobsUrl(new URLSearchParams(serializeJobsUrl(s).slice(1))), s);
});

test("serializeJobsUrl omits posted for the 30d default", () => {
    assert.equal(serializeJobsUrl({ ...DEFAULT_URL_STATE, q: "sre" }), "?q=sre");
});

test("serializeJobsUrl writes posted=any for an explicit no-filter state", () => {
    const url = serializeJobsUrl({ ...DEFAULT_URL_STATE, postedBucket: undefined, postedExplicit: true });
    assert.equal(url, "?posted=any");
});

test("posted=any round-trips through serialize + parse", () => {
    const s = { ...DEFAULT_URL_STATE, postedBucket: undefined, postedExplicit: true };
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

// (g) Picked-field provenance URL grammar. `city=`/`state=` are NEW params
// added alongside the pre-existing `country=`, wired through the SAME
// generic FACET_PARAMS loop rather than a parallel encoding — no new parsing
// code, and `country=` itself is untouched.
test("(g) back-compat: a legacy country= URL still parses into facets.location_country exactly as before — the new city=/state= params never intercept it", () => {
    const s = parseJobsUrl(new URLSearchParams("country=Canada"));
    assert.deepEqual(s.facets, { location_country: ["Canada"] });
    assert.equal(serializeJobsUrl({ ...DEFAULT_URL_STATE, facets: { location_country: ["Canada"] } }), "?country=Canada");
});

test("(g) city= and state= round-trip through the generic facet param loop, same as country=", () => {
    const s = {
        ...DEFAULT_URL_STATE,
        facets: { location_city: ["San Jose"], location_state: ["Georgia"] },
    };
    const url = serializeJobsUrl(s);
    assert.equal(url, "?city=San+Jose&state=Georgia");
    assert.deepEqual(parseJobsUrl(new URLSearchParams(url.slice(1))), s);
});

test("(g) all three location params compose on one URL without colliding — city, state, and a free-text country pick are three independent facet keys", () => {
    const s = {
        ...DEFAULT_URL_STATE,
        facets: { location_city: ["San Jose"], location_state: ["Georgia"], location_country: ["Canada"] },
    };
    const url = serializeJobsUrl(s);
    assert.deepEqual(parseJobsUrl(new URLSearchParams(url.slice(1))), s);
});

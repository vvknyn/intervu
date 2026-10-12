import { test } from "node:test";
import assert from "node:assert/strict";
import {
    buildJobOpenEntry,
    buildSearchLogEntry,
    hasExplicitFilters,
    isSweepDue,
    shouldLogSearch,
    SEARCH_LOG_LIST_MAX,
    SEARCH_LOG_Q_MAX,
    SEARCH_LOG_TTL_DAYS,
    SWEEP_EVERY_MS,
} from "../../src/lib/jobs/search-log";
import type { JobSearchParams, JobSearchResult } from "../../src/lib/jobs/types";

const NOW = Date.parse("2026-07-26T12:00:00Z");
const CTX = { searchId: "sid-1", now: NOW };

const result = (over: Partial<JobSearchResult> = {}): JobSearchResult => ({
    hits: [],
    total: 42,
    backend: "meilisearch",
    configured: true,
    ...over,
});

test("records the query, its true length, and the result count", () => {
    const e = buildSearchLogEntry({ q: "  senior backend engineer  " }, result(), CTX);
    assert.equal(e.q, "senior backend engineer");
    assert.equal(e.qLength, "senior backend engineer".length);
    assert.equal(e.resultCount, 42);
    assert.equal(e.searchId, "sid-1");
});

test("truncates stored text but keeps the pre-truncation length", () => {
    const long = "a".repeat(SEARCH_LOG_Q_MAX + 50);
    const e = buildSearchLogEntry({ q: long }, result(), CTX);
    assert.equal(e.q.length, SEARCH_LOG_Q_MAX);
    assert.equal(e.qLength, SEARCH_LOG_Q_MAX + 50, "qLength must survive truncation");
});

test("carries no identifying fields, even when the params object has extras", () => {
    const dirty = { q: "nurse", uid: "user-123", ip: "1.2.3.4" } as unknown as JobSearchParams;
    const e = buildSearchLogEntry(dirty, result(), CTX) as unknown as Record<string, unknown>;
    for (const k of ["uid", "ip", "userAgent", "user_id", "email"]) {
        assert.equal(k in e, false, `${k} must never reach the log`);
    }
});

test("widened and unavailable default to false when the backend omits them", () => {
    const e = buildSearchLogEntry({ q: "x" }, result(), CTX);
    assert.equal(e.widened, false);
    assert.equal(e.unavailable, false);

    const w = buildSearchLogEntry({ q: "x" }, result({ widened: true, unavailable: true }), CTX);
    assert.equal(w.widened, true);
    assert.equal(w.unavailable, true);
});

test("records the posted bucket so the invisible 30d default is visible in the data", () => {
    assert.equal(buildSearchLogEntry({ q: "x", postedBucket: "30d" }, result(), CTX).postedBucket, "30d");
    assert.equal(buildSearchLogEntry({ q: "x", postedBucket: "1d" }, result(), CTX).postedBucket, "1d");
    assert.equal(buildSearchLogEntry({ q: "x" }, result(), CTX).postedBucket, "");
});

test("only explicit filters count as filtering — defaults do not", () => {
    assert.equal(hasExplicitFilters({}), false);
    assert.equal(hasExplicitFilters({ postedBucket: "30d" }), false, "the fresh-visit default is not intent");
    assert.equal(hasExplicitFilters({ hideGhosts: true }), false, "first-screen default is not intent");
    assert.equal(hasExplicitFilters({ facets: {} }), false);
    assert.equal(hasExplicitFilters({ facets: { work_type: [] } }), false, "an empty facet is not a filter");

    assert.equal(hasExplicitFilters({ facets: { work_type: ["remote"] } }), true);
    assert.equal(hasExplicitFilters({ salaryMin: 100000 }), true);
    assert.equal(hasExplicitFilters({ visaOnly: true }), true);
    assert.equal(hasExplicitFilters({ visaOnly: false }), false);
});

test("the dead-link id probe is not a human search", () => {
    assert.equal(shouldLogSearch({ q: "designer" }), true);
    assert.equal(shouldLogSearch({}), true, "an empty browse is still a real visit");
    assert.equal(shouldLogSearch({ id: "job-9" }), false);
    assert.equal(shouldLogSearch({ q: "Registered Nurse Cedarbrook Health", automatic: true }), false, "the extension card's own lookup isn't a search");
    assert.equal(
        shouldLogSearch({ q: '"Registered Nurse" OR "Charge Nurse"', fromResume: true }),
        false,
        "a query built from a résumé never lands in search_events",
    );
});

test("a later page of the same list and a Broaden count probe are not new searches", () => {
    assert.equal(shouldLogSearch({ q: "nurse", limit: 30, offset: 0 }), true, "the first page is the search");
    assert.equal(shouldLogSearch({ q: "nurse", limit: 30, offset: 30 }), false, "load more is the same search");
    assert.equal(shouldLogSearch({ q: "nurse", limit: 1, offset: 0 }), false, "Broaden's how-many-if probe");
    assert.equal(shouldLogSearch({ q: "nurse", limit: 0 }), false, "a count-only probe");
});

test("records where the search looked and which companies it found nothing at, for the demand view", () => {
    const e = buildSearchLogEntry(
        {
            q: "registered nurse",
            facets: { location_city: ["Calgary"], location_country: ["Canada"], work_type: ["remote"], experience_level: ["mid"] },
            companyDomain: "ahs.ca",
        },
        result({
            total: 0,
            defaultedLocation: "CA",
            unmatchedPlaceMentions: ["Narnia"],
            companyIntent: { domains: ["albertahealthservices.ca"], scopedTotal: 0, fallback: true },
        } as Partial<JobSearchResult>),
        CTX,
    );
    assert.deepEqual([...e.places].sort(), ["Calgary", "Canada"]);
    assert.equal(e.defaultedCountry, "CA");
    assert.deepEqual(e.unmatchedPlaces, ["Narnia"]);
    assert.equal(e.company, "ahs.ca");
    assert.deepEqual(e.missedCompanies, ["albertahealthservices.ca"]);
    assert.deepEqual(e.filters.sort(), ["experience_level:mid", "work_type:remote"]);
});

test("a company the query matched is only a miss when the scoped search found nothing", () => {
    const found = buildSearchLogEntry(
        { q: "shopify" },
        result({ companyIntent: { domains: ["shopify.com"], scopedTotal: 0, fallback: false } } as Partial<JobSearchResult>),
        CTX,
    );
    assert.deepEqual(found.missedCompanies, []);
    const plain = buildSearchLogEntry({ q: "nurse" }, result(), CTX);
    assert.deepEqual(
        { places: plain.places, unmatched: plain.unmatchedPlaces, company: plain.company, missed: plain.missedCompanies, filters: plain.filters, country: plain.defaultedCountry },
        { places: [], unmatched: [], company: "", missed: [], filters: [], country: "" },
    );
});

test("place, company and filter lists are capped, trimmed and de-duplicated", () => {
    const many = Array.from({ length: SEARCH_LOG_LIST_MAX + 4 }, (_, i) => `City ${i}`);
    const e = buildSearchLogEntry(
        { q: "x", facets: { location_city: ["  Toronto ", "Toronto", "", ...many] } },
        result({ unmatchedPlaceMentions: ["a".repeat(500)] } as Partial<JobSearchResult>),
        CTX,
    );
    assert.equal(e.places.length, SEARCH_LOG_LIST_MAX);
    assert.equal(e.places[0], "Toronto");
    assert.equal(e.places.filter((p) => p === "Toronto").length, 1);
    assert.ok(e.unmatchedPlaces[0].length <= 80);
});

test("expired records are swept at most every few hours per server", () => {
    assert.equal(isSweepDue(0, NOW), true, "a fresh server sweeps on its first write");
    assert.equal(isSweepDue(NOW, NOW + 60_000), false);
    assert.equal(isSweepDue(NOW, NOW + SWEEP_EVERY_MS), true);
});

test("every event carries a TTL the retention policy can act on", () => {
    const e = buildSearchLogEntry({ q: "x" }, result(), CTX);
    assert.equal(e.createdAt, "2026-07-26T12:00:00.000Z");
    assert.equal(
        Date.parse(e.expiresAt) - Date.parse(e.createdAt),
        SEARCH_LOG_TTL_DAYS * 86_400_000,
    );
});

test("an opened result records its rank, which is the relevance signal", () => {
    const e = buildJobOpenEntry("sid-1", "job-9", 3, NOW);
    assert.deepEqual(
        { searchId: e.searchId, jobId: e.jobId, rank: e.rank },
        { searchId: "sid-1", jobId: "job-9", rank: 3 },
    );
    assert.equal(e.createdAt, "2026-07-26T12:00:00.000Z");
});

test("builders are pure — same inputs, same output", () => {
    const params: JobSearchParams = { q: "data engineer", facets: { work_type: ["remote"] } };
    assert.deepEqual(
        buildSearchLogEntry(params, result(), CTX),
        buildSearchLogEntry(params, result(), CTX),
    );
});

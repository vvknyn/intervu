import { test } from "node:test";
import assert from "node:assert/strict";
import { isEmployerSiteSource, rowSourceFacts } from "../../src/lib/jobs/row-source-facts";

const NOW = Date.parse("2026-10-26T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const job = (source: string, posted: number | null, firstSeen: number | null) => ({
    source,
    posted_at: posted == null ? null : daysAgo(posted),
    first_seen_at: firstSeen == null ? null : daysAgo(firstSeen),
});

test("an adapter-labelled source is the employer's site, whichever adapter", () => {
    for (const source of ["greenhouse_direct", "workday_direct", "careers_direct", "html_direct", "some_new_ats_direct"]) {
        assert.equal(isEmployerSiteSource(source), true, source);
    }
});

test("a board-sourced row gets no employer-site pill; an unknown source gets none either", () => {
    for (const source of ["onlinejobs", "api_ingest", "", "serpapi"]) {
        assert.equal(rowSourceFacts(job(source, 40, 39), NOW).fromEmployerSite, false, source);
    }
    assert.equal(isEmployerSiteSource(null), false);
    assert.equal(isEmployerSiteSource(undefined), false);
});

test("an employer-site row carries the pill, new or old", () => {
    assert.equal(rowSourceFacts(job("lever_direct", 40, 39), NOW).fromEmployerSite, true);
    assert.equal(rowSourceFacts(job("lever_direct", 6, 1), NOW).fromEmployerSite, true);
});

test("a new row (first seen this week, posted earlier) says when Velai first saw it", () => {
    assert.equal(rowSourceFacts(job("onlinejobs", 6, 1), NOW).firstSeen, "1d ago");
    assert.equal(rowSourceFacts(job("greenhouse_direct", 5, 0), NOW).firstSeen, "today");
});

test("an old row gets no first-seen pill", () => {
    assert.equal(rowSourceFacts(job("greenhouse_direct", 40, 39), NOW).firstSeen, null);
    assert.equal(rowSourceFacts(job("greenhouse_direct", 8, 8), NOW).firstSeen, null);
});

test("a relisted row (posted after we first saw it) is not newly listed", () => {
    assert.equal(rowSourceFacts(job("greenhouse_direct", 0, 20), NOW).firstSeen, null);
});

test("no first-seen pill when the row's own age already says it, or when first_seen_at is unknown", () => {
    assert.equal(rowSourceFacts(job("onlinejobs", 1, 1), NOW).firstSeen, null);
    assert.equal(rowSourceFacts(job("onlinejobs", null, 1), NOW).firstSeen, null);
    assert.equal(rowSourceFacts(job("onlinejobs", 3, null), NOW).firstSeen, null);
});

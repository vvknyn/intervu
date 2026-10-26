import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyPostingFreshness } from "../../src/lib/jobs/posting-freshness";
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

test("a row first seen this week is New, whichever source", () => {
    assert.equal(rowSourceFacts(job("onlinejobs", 6, 1), NOW).isNew, true);
    assert.equal(rowSourceFacts(job("greenhouse_direct", 5, 0), NOW).isNew, true);
    assert.equal(rowSourceFacts(job("", 3, 1), NOW).isNew, true);
});

test("an old row is not New", () => {
    assert.equal(rowSourceFacts(job("greenhouse_direct", 40, 39), NOW).isNew, false);
    assert.equal(rowSourceFacts(job("greenhouse_direct", 8, 8), NOW).isNew, false);
});

test("a relisted row (posted after we first saw it) is not New", () => {
    assert.equal(rowSourceFacts(job("greenhouse_direct", 0, 20), NOW).isNew, false);
});

test("New follows the shared freshness rule exactly, including when first_seen_at is unknown", () => {
    for (const [posted, seen] of [[1, 1], [null, 1], [3, null], [null, null]] as const) {
        const { kind } = classifyPostingFreshness(job("onlinejobs", posted, seen), NOW);
        assert.equal(rowSourceFacts(job("onlinejobs", posted, seen), NOW).isNew, kind === "fresh");
    }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { isNarrowedResultSet, searchResultLine } from "../../src/lib/jobs/presentation";

const NOW = Date.parse("2026-07-26T12:00:00Z");
const TWO_HOURS_AGO = "2026-07-26T10:00:00Z";

test("names the 30-day window, so the count is not read as the corpus", () => {
    const line = searchResultLine({
        count: { kind: "exact", value: 412 },
        postedBucket: "30d",
        lastUpdated: TWO_HOURS_AGO,
        nowMs: NOW,
        narrowed: false,
    });
    assert.match(line, /^412 roles from the last 30 days · updated /);
});

test("every window the user can land in reads as a sentence", () => {
    const of = (postedBucket: Parameters<typeof searchResultLine>[0]["postedBucket"]) =>
        searchResultLine({ count: { kind: "exact", value: 9 }, postedBucket, lastUpdated: null, nowMs: NOW, narrowed: false });

    assert.equal(of("1d"), "9 roles from the last 24 hours");
    assert.equal(of("3d"), "9 roles from the last 3 days");
    assert.equal(of("7d"), "9 roles from the last 7 days");
    assert.equal(of("30d"), "9 roles from the last 30 days");
    assert.equal(of("older"), "9 roles posted more than 30 days ago");
});

test("no window means the user cleared it — claim nothing", () => {
    assert.equal(
        searchResultLine({ count: { kind: "exact", value: 5 }, postedBucket: undefined, lastUpdated: null, nowMs: NOW, narrowed: false }),
        "5 roles",
    );
});

test("a missing freshness stamp is omitted, never guessed", () => {
    for (const lastUpdated of [null, undefined, ""]) {
        const line = searchResultLine({
            count: { kind: "exact", value: 5 },
            postedBucket: "30d",
            lastUpdated,
            nowMs: NOW,
            narrowed: false,
        });
        assert.equal(line, "5 roles from the last 30 days", `lastUpdated=${JSON.stringify(lastUpdated)}`);
    }
});

test("a capped count stays honest — never a bare number", () => {
    const line = searchResultLine({
        count: { kind: "floor", value: 100_000 },
        postedBucket: "30d",
        lastUpdated: null,
        nowMs: NOW,
        narrowed: false,
    });
    assert.equal(line, "100,000+ roles from the last 30 days");
});

test("one result is singular", () => {
    assert.equal(
        searchResultLine({ count: { kind: "exact", value: 1 }, postedBucket: "30d", lastUpdated: null, nowMs: NOW, narrowed: false }),
        "1 role from the last 30 days",
    );
    assert.match(
        searchResultLine({ count: { kind: "exact", value: 0 }, postedBucket: "30d", lastUpdated: null, nowMs: NOW, narrowed: false }),
        /^0 roles /,
    );
});

test("Deliverable 2 — the updated-clause shows under 48h", () => {
    const fortySevenHoursAgo = new Date(NOW - 47 * 3_600_000).toISOString();
    const line = searchResultLine({
        count: { kind: "exact", value: 5 },
        postedBucket: undefined,
        lastUpdated: fortySevenHoursAgo,
        nowMs: NOW,
        narrowed: false,
    });
    assert.match(line, /^5 roles · updated /);
});

test("Deliverable 2 — the updated-clause is omitted at/past 48h, not shown stale", () => {
    const fortyNineHoursAgo = new Date(NOW - 49 * 3_600_000).toISOString();
    assert.equal(
        searchResultLine({
            count: { kind: "exact", value: 5 },
            postedBucket: undefined,
            lastUpdated: fortyNineHoursAgo,
            nowMs: NOW,
            narrowed: false,
        }),
        "5 roles",
    );
});

test("Deliverable 2 — a missing stamp omits the clause too (not a special case, same as the 48h+ branch)", () => {
    assert.equal(
        searchResultLine({ count: { kind: "exact", value: 5 }, postedBucket: undefined, lastUpdated: null, nowMs: NOW, narrowed: false }),
        "5 roles",
    );
});

test("pure — same inputs, same string", () => {
    const args = {
        count: { kind: "exact", value: 412 } as const,
        postedBucket: "30d" as const,
        lastUpdated: TWO_HOURS_AGO,
        nowMs: NOW,
        narrowed: false,
    };
    assert.equal(searchResultLine(args), searchResultLine(args));
});

// --- Freshness-line truthfulness: a corpus-wide stamp is not a fact about a
// narrowed set (founder repro: an employer drawer showing "7 roles · updated
// 40 min ago" while the 7 listings behind it were 3 months old — the clause
// was never about those 7 documents, only about MAX(updated_at) across the
// whole index). ---

test("a text-query result set drops the corpus clause, keeps the count", () => {
    const line = searchResultLine({
        count: { kind: "exact", value: 23 },
        postedBucket: "30d",
        lastUpdated: TWO_HOURS_AGO,
        nowMs: NOW,
        narrowed: true,
    });
    assert.equal(line, "23 roles from the last 30 days");
});

test("an employer/company drawer set drops the corpus clause — the founder's exact repro", () => {
    const line = searchResultLine({
        count: { kind: "exact", value: 7 },
        postedBucket: undefined,
        lastUpdated: "2026-07-26T11:20:00Z", // 40 minutes before NOW
        nowMs: NOW,
        narrowed: true,
    });
    assert.equal(line, "7 roles");
});

test("a country-filtered set drops the corpus clause, singular count still correct", () => {
    const line = searchResultLine({
        count: { kind: "exact", value: 1 },
        postedBucket: "30d",
        lastUpdated: TWO_HOURS_AGO,
        nowMs: NOW,
        narrowed: true,
    });
    assert.equal(line, "1 role from the last 30 days");
});

test("an unfiltered corpus set keeps the clause and copy exactly as before", () => {
    const line = searchResultLine({
        count: { kind: "exact", value: 412 },
        postedBucket: "30d",
        lastUpdated: TWO_HOURS_AGO,
        nowMs: NOW,
        narrowed: false,
    });
    assert.equal(line, "412 roles from the last 30 days · updated 2h ago");
});

// --- isNarrowedResultSet: the pure decision `searchResultLine`'s caller
// (the SERP) feeds into `narrowed` above. ---

test("isNarrowedResultSet: a text query alone narrows", () => {
    assert.equal(isNarrowedResultSet({ hasQuery: true, activeFilterCount: 0, hasCorpusScope: false }), true);
});

test("isNarrowedResultSet: an active facet (e.g. a country filter) alone narrows", () => {
    assert.equal(isNarrowedResultSet({ hasQuery: false, activeFilterCount: 1, hasCorpusScope: false }), true);
});

test("isNarrowedResultSet: corpus scope (board or single-employer drawer) alone narrows, even with zero chips", () => {
    // `companyDomain` deliberately renders no chip of its own
    // (`activeFilterEntries`'s comment, FilterPanel.tsx) — activeFilterCount
    // can be 0 while the set is still scoped to one employer.
    assert.equal(isNarrowedResultSet({ hasQuery: false, activeFilterCount: 0, hasCorpusScope: true }), true);
});

test("isNarrowedResultSet: none of the three narrowing signals means the whole corpus", () => {
    assert.equal(isNarrowedResultSet({ hasQuery: false, activeFilterCount: 0, hasCorpusScope: false }), false);
});

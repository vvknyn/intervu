import { test } from "node:test";
import assert from "node:assert/strict";
import { searchResultLine, liveCountLine } from "../../src/lib/jobs/presentation";

const NOW = Date.parse("2026-07-26T12:00:00Z");
const TWO_HOURS_AGO = "2026-07-26T10:00:00Z";

test("names the 30-day window, so the count is not read as the corpus", () => {
    const line = searchResultLine({
        count: { kind: "exact", value: 412 },
        postedBucket: "30d",
        lastUpdated: TWO_HOURS_AGO,
        nowMs: NOW,
    });
    assert.match(line, /^412 roles from the last 30 days · updated /);
});

test("every window the user can land in reads as a sentence", () => {
    const of = (postedBucket: Parameters<typeof searchResultLine>[0]["postedBucket"]) =>
        searchResultLine({ count: { kind: "exact", value: 9 }, postedBucket, lastUpdated: null, nowMs: NOW });

    assert.equal(of("1d"), "9 roles from the last 24 hours");
    assert.equal(of("3d"), "9 roles from the last 3 days");
    assert.equal(of("7d"), "9 roles from the last 7 days");
    assert.equal(of("30d"), "9 roles from the last 30 days");
    assert.equal(of("older"), "9 roles posted more than 30 days ago");
});

test("no window means the user cleared it — claim nothing", () => {
    assert.equal(
        searchResultLine({ count: { kind: "exact", value: 5 }, postedBucket: undefined, lastUpdated: null, nowMs: NOW }),
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
    });
    assert.equal(line, "100,000+ roles from the last 30 days");
});

test("one result is singular", () => {
    assert.equal(
        searchResultLine({ count: { kind: "exact", value: 1 }, postedBucket: "30d", lastUpdated: null, nowMs: NOW }),
        "1 role from the last 30 days",
    );
    assert.match(
        searchResultLine({ count: { kind: "exact", value: 0 }, postedBucket: "30d", lastUpdated: null, nowMs: NOW }),
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
        }),
        "5 roles",
    );
});

test("Deliverable 2 — a missing stamp omits the clause too (not a special case, same as the 48h+ branch)", () => {
    assert.equal(
        searchResultLine({ count: { kind: "exact", value: 5 }, postedBucket: undefined, lastUpdated: null, nowMs: NOW }),
        "5 roles",
    );
});

test("pure — same inputs, same string", () => {
    const args = {
        count: { kind: "exact", value: 412 } as const,
        postedBucket: "30d" as const,
        lastUpdated: TWO_HOURS_AGO,
        nowMs: NOW,
    };
    assert.equal(searchResultLine(args), searchResultLine(args));
});

// --- Freshness-line truthfulness (intervu #484): `searchResultLine` no
// longer decides whether the clause is safe to show by re-deriving
// "narrowed" from chip counts (`isNarrowedResultSet`, deleted — it read the
// filter-CHIP count, which deliberately hides the untouched 30-day default,
// so a pristine /jobs visit — a real backend filter per
// `jobs-posted-default-honesty.test.ts` — still showed the corpus stamp
// beside filtered cards). The correctness burden moved to the CALLER
// (jobs/page.tsx): `lastUpdated` is now trusted to already be MAX(updated_at)
// over the exact same population `count` describes — computed via
// `buildLastUpdatedQuery` (meilisearch.ts) from the SAME
// `buildJobSearchPayload` the results search used. So at this layer, a
// present/fresh `lastUpdated` always renders, for every narrowing shape:
// there is no enumeration to fall out of sync with a new filter. ---

test("a text-query result set's own stamp renders — the caller already scoped it to this query", () => {
    const line = searchResultLine({
        count: { kind: "exact", value: 23 },
        postedBucket: "30d",
        lastUpdated: TWO_HOURS_AGO,
        nowMs: NOW,
    });
    assert.equal(line, "23 roles from the last 30 days · updated 2h ago");
});

test("an employer/company drawer's own stamp renders — the founder's exact repro, now scoped correctly upstream", () => {
    const line = searchResultLine({
        count: { kind: "exact", value: 7 },
        postedBucket: undefined,
        lastUpdated: "2026-07-26T11:20:00Z", // 40 minutes before NOW
        nowMs: NOW,
    });
    assert.equal(line, "7 roles · updated 40 min ago");
});

test("a country-filtered set's own stamp renders, singular count still correct", () => {
    const line = searchResultLine({
        count: { kind: "exact", value: 1 },
        postedBucket: "30d",
        lastUpdated: TWO_HOURS_AGO,
        nowMs: NOW,
    });
    assert.equal(line, "1 role from the last 30 days · updated 2h ago");
});

test("the pristine default (untouched 30d window, no query, no facets, no scope) shows its own stamp — the state the enumeration gate used to miss", () => {
    const line = searchResultLine({
        count: { kind: "exact", value: 5_820 },
        postedBucket: "30d",
        lastUpdated: TWO_HOURS_AGO,
        nowMs: NOW,
    });
    assert.equal(line, "5,820 roles from the last 30 days · updated 2h ago");
});

test("an unfiltered whole-corpus set (explicit Any-date) keeps the clause and copy exactly as before", () => {
    const line = searchResultLine({
        count: { kind: "exact", value: 412 },
        postedBucket: undefined,
        lastUpdated: TWO_HOURS_AGO,
        nowMs: NOW,
    });
    assert.equal(line, "412 roles · updated 2h ago");
});

test("a stamp the caller couldn't resolve (null) omits the clause, string stays well-formed — no dangling separator", () => {
    const line = searchResultLine({
        count: { kind: "exact", value: 7 },
        postedBucket: undefined,
        lastUpdated: null,
        nowMs: NOW,
    });
    assert.equal(line, "7 roles");
    assert.doesNotMatch(line, /·\s*$/);
    assert.doesNotMatch(line, /\s{2,}/);
});

// Honesty fix (intervu first-screen audit, Defect 1): the masthead's live
// count (`vacancy_status = "active"`, NO posted-date filter — market-trends.ts)
// and this file's `searchResultLine` (a 30-day default, `!= "closed"`) used
// to render with no stated relationship between them ("2,339,946 live roles"
// beside "111,151 roles from the last 30 days"). `liveCountLine` gives the
// masthead its own honestly-scoped wording instead of a bare number.
test("liveCountLine: states its own scope, parallel to searchResultLine's window clause", () => {
    assert.equal(liveCountLine({ kind: "exact", value: 2_339_946 }), "2,339,946 live roles tracked, all posting dates");
});

test("liveCountLine: a capped count still renders through formatCorpusCount, never a bare number", () => {
    assert.equal(liveCountLine({ kind: "floor", value: 100_000 }), "100,000+ live roles tracked, all posting dates");
});

test("liveCountLine: null (the marketing-stats probe came back empty) omits the line entirely — never a fabricated 0", () => {
    assert.equal(liveCountLine(null), null);
});

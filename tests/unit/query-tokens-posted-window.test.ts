import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePostedWindowTokens } from "../../src/lib/jobs/query-tokens/posted-window";
import { applyQueryUnderstanding } from "../../src/lib/jobs/query-understanding";
import { stripDefaulted } from "../../src/lib/jobs/search-defaults";

const cases: [string, string, string][] = [
    ["PM jobs posted this week", "7d", "PM jobs"],
    ["backend engineer posted today", "1d", "backend engineer"],
    ["react developer, last 30 days", "30d", "react developer"],
    ["senior PM, posted in the last 2 weeks", "30d", "senior PM"],
    ["nurse past week", "7d", "nurse"],
    ["nurse last 7 days", "7d", "nurse"],
    ["nurse last 3 days", "3d", "nurse"],
    ["nurse last 4 days", "7d", "nurse"],
    ["nurse past 1 month", "30d", "nurse"],
    ["nurse last 90 days", "90d", "nurse"],
    ["nurse within the last two weeks", "30d", "nurse"],
    ["nurse posted within 5 days", "7d", "nurse"],
    ["nurse last week", "7d", "nurse"],
    ["nurse this month", "30d", "nurse"],
];
for (const [q, postedBucket, residualQ] of cases) {
    test(`posted window: ${q}`, () => assert.deepEqual(parsePostedWindowTokens(q), { residualQ, postedBucket }));
}

test("'recent' alone, 'today's', and plain unit words are not windows", () => {
    for (const q of ["recent product manager", "today's special chef", "3 days in office max", "weekly planner", "last mile driver"]) {
        assert.deepEqual(parsePostedWindowTokens(q), { residualQ: q });
    }
});

test("a window past the widest bucket is a mention, not a filter and not search words", () => {
    assert.deepEqual(parsePostedWindowTokens("nurse last 6 months"), { residualQ: "nurse", mentions: ["posted within last 6 months"] });
});

test("a quoted phrase is never consumed", () => {
    assert.deepEqual(parsePostedWindowTokens('"this week" analyst'), { residualQ: '"this week" analyst' });
});

test("a pristine default postedBucket is overridden by a typed window (3504651f path)", async () => {
    const raw = { q: "pm posted this week", postedBucket: "90d" as const, defaultedFields: ["postedBucket" as const] };
    const out = await applyQueryUnderstanding(stripDefaulted(raw));
    assert.equal(out.postedBucket, "7d");
    assert.equal(out.q, "pm");
});

test("an explicit postedBucket is never overridden and the typed words stay", async () => {
    const p = { q: "pm posted this week", postedBucket: "30d" as const };
    assert.equal(await applyQueryUnderstanding(p), p);
});

test("an out-of-range window lands in unmatchedQueryMentions through applyQueryUnderstanding", async () => {
    const out = await applyQueryUnderstanding({ q: "nurse last 6 months" });
    assert.equal(out.q, "nurse");
    assert.deepEqual(out.unmatchedQueryMentions, ["posted within last 6 months"]);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { searchResultLine } from "../../src/lib/jobs/presentation";

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

test("pure — same inputs, same string", () => {
    const args = {
        count: { kind: "exact", value: 412 } as const,
        postedBucket: "30d" as const,
        lastUpdated: TWO_HOURS_AGO,
        nowMs: NOW,
    };
    assert.equal(searchResultLine(args), searchResultLine(args));
});

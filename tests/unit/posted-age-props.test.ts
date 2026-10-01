import { test } from "node:test";
import assert from "node:assert/strict";
import { postedAgeAnalyticsProps } from "../../src/lib/analytics/posted-age-props";

const NOW = Date.UTC(2026, 8, 30, 12);
const DAY = 86_400_000;

test("a role posted 45 days ago reports posted_age_days 45", () => {
    assert.deepEqual(postedAgeAnalyticsProps({ posted_ts: NOW - 45 * DAY - 3_600_000 }, NOW), { posted_age_days: 45 });
});

test("a role posted today reports 0, and a future-dated one never goes negative", () => {
    assert.deepEqual(postedAgeAnalyticsProps({ posted_ts: NOW - 60_000 }, NOW), { posted_age_days: 0 });
    assert.deepEqual(postedAgeAnalyticsProps({ posted_ts: NOW + 2 * DAY }, NOW), { posted_age_days: 0 });
});

test("no posted date, or no row, adds nothing (never a fabricated 0)", () => {
    assert.deepEqual(postedAgeAnalyticsProps({ posted_ts: null }, NOW), {});
    assert.deepEqual(postedAgeAnalyticsProps({}, NOW), {});
    assert.deepEqual(postedAgeAnalyticsProps(undefined, NOW), {});
});

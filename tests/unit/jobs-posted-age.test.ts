import { test } from "node:test";
import assert from "node:assert/strict";
import { postedAgeShort } from "../../src/lib/jobs/presentation";

const NOW = Date.parse("2026-07-26T12:00:00Z");
const daysAgo = (n: number) => NOW - n * 86_400_000;

test("posted today", () => {
    assert.equal(postedAgeShort(NOW, NOW), "today");
    assert.equal(postedAgeShort(daysAgo(0.5), NOW), "today");
});

test("1 day ago", () => {
    assert.equal(postedAgeShort(daysAgo(1), NOW), "1d ago");
});

test("11 days ago", () => {
    assert.equal(postedAgeShort(daysAgo(11), NOW), "11d ago");
});

test("boundary at 30 days flips from days to months", () => {
    assert.equal(postedAgeShort(daysAgo(29), NOW), "29d ago");
    assert.equal(postedAgeShort(daysAgo(30), NOW), "1mo ago");
});

test("2 months ago", () => {
    assert.equal(postedAgeShort(daysAgo(60), NOW), "2mo ago");
});

test("boundary at 12 months (360 days) flips from months to years", () => {
    assert.equal(postedAgeShort(daysAgo(359), NOW), "11mo ago");
    assert.equal(postedAgeShort(daysAgo(360), NOW), "1y ago");
});

test("1 year ago", () => {
    assert.equal(postedAgeShort(daysAgo(400), NOW), "1y ago");
});

test("null timestamp yields no age", () => {
    assert.equal(postedAgeShort(null, NOW), null);
});

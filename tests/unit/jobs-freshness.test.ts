import { test } from "node:test";
import assert from "node:assert/strict";
import { formatRelativeAge, isStale, STALE_THRESHOLD_MS } from "../../src/lib/jobs/freshness";

const NOW = Date.parse("2026-07-18T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

test("formatRelativeAge buckets", () => {
    assert.equal(formatRelativeAge(ago(30_000), NOW), "just now");
    assert.equal(formatRelativeAge(ago(6 * 60_000), NOW), "6 min ago");
    assert.equal(formatRelativeAge(ago(2 * 3_600_000), NOW), "2h ago");
    assert.equal(formatRelativeAge(ago(3 * 86_400_000), NOW), "3d ago");
});

test("isStale honors threshold and treats null as stale", () => {
    assert.equal(isStale(ago(STALE_THRESHOLD_MS + 1), NOW), true);
    assert.equal(isStale(ago(3_600_000), NOW), false);
    assert.equal(isStale(null, NOW), true);
});

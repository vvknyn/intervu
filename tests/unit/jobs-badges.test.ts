import { test } from "node:test";
import assert from "node:assert/strict";
import { badgeFor, daysOpenFrom } from "../../src/lib/jobs/badges";
import { STALE_THRESHOLD_MS } from "../../src/lib/jobs/freshness";

const NOW = Date.parse("2026-07-18T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

test("clear badge carries a live age when updated_at is within the freshness threshold", () => {
    assert.equal(badgeFor("clear", ago(30_000), null, NOW), "✓ live just now");
    assert.equal(badgeFor("clear", ago(3 * 3_600_000), null, NOW), "✓ live 3h ago");
});

test("clear badge: two distinct within-threshold updated_at inputs produce two distinct ages", () => {
    const recent = badgeFor("clear", ago(6 * 60_000), null, NOW);
    const older = badgeFor("clear", ago(2 * 3_600_000), null, NOW);
    assert.equal(recent, "✓ live 6 min ago");
    assert.equal(older, "✓ live 2h ago");
    assert.notEqual(recent, older);
});

test("clear badge just under the freshness threshold still claims live", () => {
    assert.equal(badgeFor("clear", ago(STALE_THRESHOLD_MS - 1), null, NOW), "✓ live 23h ago");
});

test("clear badge just over the freshness threshold drops the live claim", () => {
    assert.equal(badgeFor("clear", ago(STALE_THRESHOLD_MS + 1), null, NOW), "checked 1d ago");
});

test("clear badge far over the freshness threshold (98d — the real production case) drops the live claim", () => {
    assert.equal(badgeFor("clear", ago(98 * 86_400_000), null, NOW), "checked 98d ago");
});

test("clear badge: two distinct over-threshold ages both render 'checked', never 'live'", () => {
    const a = badgeFor("clear", ago(22 * 86_400_000), null, NOW);
    const b = badgeFor("clear", ago(98 * 86_400_000), null, NOW);
    assert.equal(a, "checked 22d ago");
    assert.equal(b, "checked 98d ago");
    assert.notEqual(a, b);
    for (const text of [a, b]) {
        assert.ok(text && !text.includes("live"), `expected no liveness claim, got "${text}"`);
    }
});

test("clear badge falls back to the neutral form (no liveness claim) when updated_at is missing", () => {
    assert.equal(badgeFor("clear", null, null, NOW), "checked");
});

test("clear badge falls back to the neutral form when updated_at is unparseable", () => {
    assert.equal(badgeFor("clear", "not-a-date", null, NOW), "checked");
});

test("caution badge reports days-open derived from posted_ts", () => {
    assert.equal(badgeFor("caution", null, NOW - 5 * 86_400_000, NOW), "⚠ 5 days open");
});

test("caution badge falls back when posted_ts is missing", () => {
    assert.equal(badgeFor("caution", null, null, NOW), "⚠ worth verifying");
});

test("likely_ghost badge is a static warning, independent of timestamps", () => {
    assert.equal(badgeFor("likely_ghost", null, null, NOW), "✕ likely ghost");
    assert.equal(badgeFor("likely_ghost", ago(1_000), NOW - 86_400_000, NOW), "✕ likely ghost");
});

test("unscored renders no badge (preserves pre-Task-8 null behavior)", () => {
    assert.equal(badgeFor("unscored", ago(1_000), NOW, NOW), null);
});

test("daysOpenFrom floors partial days and never goes negative", () => {
    assert.equal(daysOpenFrom(NOW - 90_000_000, NOW), 1); // ~1.04d -> 1
    assert.equal(daysOpenFrom(NOW + 10_000, NOW), 0); // future clock-skew clamps to 0
    assert.equal(daysOpenFrom(null, NOW), null);
});

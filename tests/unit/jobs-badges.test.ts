import { test } from "node:test";
import assert from "node:assert/strict";
import { badgeFor, checkFreshness, daysOpenFrom } from "../../src/lib/jobs/badges";
import { STALE_CHECK_DAYS, STALE_THRESHOLD_MS } from "../../src/lib/jobs/freshness";

const NOW = Date.parse("2026-07-18T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const STALE_CHECK_MS = STALE_CHECK_DAYS * 86_400_000;

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

test("clear badge within STALE_CHECK_DAYS but past the live threshold still says 'checked'", () => {
    assert.equal(badgeFor("clear", ago(22 * 86_400_000), null, NOW), "checked 22d ago");
});

// Phase 1-a #5 (production bug this fixes): a "clear" verdict from a
// STALE_CHECK_DAYS+ -old check overstates it even as neutral "checked" text
// — it drops to "last seen {age}" instead. 98d is the real production case
// (rows last checked 99-112 days ago still rendering a green "checked"
// badge next to a dead apply link).
test("clear badge far over STALE_CHECK_DAYS (98d — the real production case) drops to 'last seen', never 'checked' or 'live'", () => {
    const text = badgeFor("clear", ago(98 * 86_400_000), null, NOW);
    assert.equal(text, "last seen 98d ago");
    assert.ok(text && !text.includes("live") && !text.includes("checked"));
});

test("clear badge just under STALE_CHECK_DAYS still says 'checked'", () => {
    assert.equal(badgeFor("clear", ago(STALE_CHECK_MS - 1), null, NOW), "checked 29d ago");
});

test("clear badge just over STALE_CHECK_DAYS switches to 'last seen'", () => {
    assert.equal(badgeFor("clear", ago(STALE_CHECK_MS + 1), null, NOW), "last seen 30d ago");
});

test("clear badge falls back to 'not recently verified' when updated_at is missing", () => {
    assert.equal(badgeFor("clear", null, null, NOW), "not recently verified");
});

test("clear badge falls back to 'not recently verified' when updated_at is unparseable", () => {
    assert.equal(badgeFor("clear", "not-a-date", null, NOW), "not recently verified");
});

test("checkFreshness: fresh within STALE_CHECK_DAYS, stale beyond it, stale for missing/unparseable", () => {
    assert.equal(checkFreshness(ago(STALE_CHECK_MS - 1), NOW), "fresh");
    assert.equal(checkFreshness(ago(STALE_CHECK_MS + 1), NOW), "stale");
    assert.equal(checkFreshness(null, NOW), "stale");
    assert.equal(checkFreshness("not-a-date", NOW), "stale");
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

import { test } from "node:test";
import assert from "node:assert/strict";
import { badgeFor, checkFreshness, daysOpenFrom, rowTrustChip, type RowTrustChip } from "../../src/lib/jobs/badges";
import { STALE_CHECK_DAYS, STALE_THRESHOLD_MS } from "../../src/lib/jobs/freshness";
import type { GhostBadge } from "../../src/lib/jobs/types";

const NOW = Date.parse("2026-07-18T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const STALE_CHECK_MS = STALE_CHECK_DAYS * 86_400_000;

/**
 * The two clocks these helpers read, kept deliberately DIFFERENT by default
 * so a test can never pass because the fixture happened to set them equal.
 * `checkedAt` is when the ghost check ran (`ghost_checked_at`); `seenAt` is
 * when we last pulled the posting (`updated_at`). Reading the second for the
 * first is the bug this file guards — see badges.ts.
 */
const job = (
    ghost_badge: GhostBadge,
    checkedAt: string | null,
    seenAt: string | null = ago(999 * 86_400_000),
) => ({ ghost_badge, ghost_checked_at: checkedAt, updated_at: seenAt });

test("clear badge carries a live age when the CHECK is within the freshness threshold", () => {
    assert.equal(badgeFor(job("clear", ago(30_000)), null, NOW), "✓ live just now");
    assert.equal(badgeFor(job("clear", ago(3 * 3_600_000)), null, NOW), "✓ live 3h ago");
});

test("clear badge: two distinct within-threshold check times produce two distinct ages", () => {
    const recent = badgeFor(job("clear", ago(6 * 60_000)), null, NOW);
    const older = badgeFor(job("clear", ago(2 * 3_600_000)), null, NOW);
    assert.equal(recent, "✓ live 6 min ago");
    assert.equal(older, "✓ live 2h ago");
    assert.notEqual(recent, older);
});

test("clear badge just under the freshness threshold still claims live", () => {
    assert.equal(badgeFor(job("clear", ago(STALE_THRESHOLD_MS - 1)), null, NOW), "✓ live 23h ago");
});

test("clear badge just over the freshness threshold drops the live claim", () => {
    assert.equal(badgeFor(job("clear", ago(STALE_THRESHOLD_MS + 1)), null, NOW), "checked 1d ago");
});

test("clear badge within STALE_CHECK_DAYS but past the live threshold still says 'checked'", () => {
    assert.equal(badgeFor(job("clear", ago(22 * 86_400_000)), null, NOW), "checked 22d ago");
});

// Phase 1-a #5 (production bug this fixes): a "clear" verdict from a
// STALE_CHECK_DAYS+ -old check overstates it even as neutral "checked" text
// — it drops to "last seen {age}" instead. 98d is the real production case
// (rows last checked 99-112 days ago still rendering a green "checked"
// badge next to a dead apply link).
test("clear badge far over STALE_CHECK_DAYS (98d — the real production case) drops to 'last seen', never 'checked' or 'live'", () => {
    const text = badgeFor(job("clear", ago(98 * 86_400_000), ago(98 * 86_400_000)), null, NOW);
    assert.equal(text, "last seen 98d ago");
    assert.ok(text && !text.includes("live") && !text.includes("checked"));
});

test("clear badge just under STALE_CHECK_DAYS still says 'checked'", () => {
    assert.equal(badgeFor(job("clear", ago(STALE_CHECK_MS - 1)), null, NOW), "checked 29d ago");
});

test("clear badge just over STALE_CHECK_DAYS switches to 'last seen'", () => {
    const stale = ago(STALE_CHECK_MS + 1);
    assert.equal(badgeFor(job("clear", stale, stale), null, NOW), "last seen 30d ago");
});

test("clear badge falls back to 'not recently verified' when there is no timestamp at all", () => {
    assert.equal(badgeFor(job("clear", null, null), null, NOW), "not recently verified");
});

test("clear badge falls back to 'not recently verified' when the timestamps are unparseable", () => {
    assert.equal(badgeFor(job("clear", "not-a-date", "not-a-date"), null, NOW), "not recently verified");
});

/**
 * The two clocks are not interchangeable, and this is the case that proves
 * the badge reads the right one: a posting scraped MINUTES ago whose ghost
 * check last ran 90 days ago. Reading `updated_at` (the old behavior) claims
 * "✓ live just now" for a three-month-old verdict; reading `ghost_checked_at`
 * correctly refuses, and dates the "last seen" clause off the scrape — the
 * one thing `updated_at` genuinely answers.
 */
test("a freshly scraped posting with a 90-day-old check is NOT live", () => {
    const text = badgeFor(job("clear", ago(90 * 86_400_000), ago(30_000)), null, NOW);
    assert.equal(text, "last seen just now");
    assert.ok(text && !text.includes("live"));
});

/** …and the mirror image: a stale scrape does not demote a current check. */
test("a stale scrape does not demote a check that ran this morning", () => {
    assert.equal(badgeFor(job("clear", ago(4 * 3_600_000), ago(120 * 86_400_000)), null, NOW), "✓ live 4h ago");
});

test("checkFreshness: fresh within STALE_CHECK_DAYS, stale beyond it, stale for missing/unparseable", () => {
    assert.equal(checkFreshness(job("clear", ago(STALE_CHECK_MS - 1)), NOW), "fresh");
    assert.equal(checkFreshness(job("clear", ago(STALE_CHECK_MS + 1)), NOW), "stale");
    assert.equal(checkFreshness(job("clear", null), NOW), "stale");
    assert.equal(checkFreshness(job("clear", "not-a-date"), NOW), "stale");
});

/**
 * A document indexed before `ghost_checked_at` existed carries no such field
 * at all. Absent must read exactly like "never scored" — unknown age, which
 * is stale — and must NOT quietly fall through to `updated_at`.
 */
test("checkFreshness: a document with no ghost_checked_at field is stale, whatever updated_at says", () => {
    assert.equal(checkFreshness({ ghost_badge: "clear" }, NOW), "stale");
    assert.equal(
        checkFreshness({ ghost_badge: "clear", ghost_checked_at: undefined }, NOW),
        "stale",
    );
});

test("caution badge reports days-open derived from posted_ts", () => {
    assert.equal(badgeFor(job("caution", null), NOW - 5 * 86_400_000, NOW), "⚠ 5 days open");
});

test("caution badge falls back when posted_ts is missing", () => {
    assert.equal(badgeFor(job("caution", null), null, NOW), "⚠ worth verifying");
});

test("likely_ghost badge is a static warning, independent of timestamps", () => {
    assert.equal(badgeFor(job("likely_ghost", null, null), null, NOW), "✕ likely ghost");
    assert.equal(badgeFor(job("likely_ghost", ago(1_000)), NOW - 86_400_000, NOW), "✕ likely ghost");
});

test("unscored renders no badge (preserves pre-Task-8 null behavior)", () => {
    assert.equal(badgeFor(job("unscored", ago(1_000)), NOW, NOW), null);
});

test("daysOpenFrom floors partial days and never goes negative", () => {
    assert.equal(daysOpenFrom(NOW - 90_000_000, NOW), 1); // ~1.04d -> 1
    assert.equal(daysOpenFrom(NOW + 10_000, NOW), 0); // future clock-skew clamps to 0
    assert.equal(daysOpenFrom(null, NOW), null);
});

// The surfaced bug: unscored jobs must render NO chip at all — rowTrustChip's
// whole reason for existing (see badges.ts doc comment).
test("rowTrustChip: unscored renders no chip", () => {
    assert.equal(rowTrustChip(job("unscored", ago(1_000)), NOW), null);
});

test("rowTrustChip: clear + fresh check reads 'clear'", () => {
    assert.equal(rowTrustChip(job("clear", ago(30_000)), NOW), "clear");
});

// Vivek, 2026-08-16: a row read "✓ VERIFIED" while its own detail panel
// itemised the evidence as "1/4 favorable". `clear` means the ghost screen
// ran and flagged nothing (`GHOST_META.clear.label` — "No ghost signals");
// nothing in this codebase verifies that a posting is genuine. No state may
// reintroduce the word — including the stale/fresh split below, which is
// where it previously crept back in.
test("rowTrustChip: NO state claims verification — the word is retired from the ladder", () => {
    const states = ["clear", "caution", "likely_ghost", "unscored"] as const;
    for (const badge of states) {
        for (const checkedAt of [ago(30_000), ago(STALE_CHECK_MS + 1), null]) {
            assert.notEqual(rowTrustChip(job(badge, checkedAt), NOW), "verified" as unknown as RowTrustChip);
        }
    }
});

test("rowTrustChip: clear + stale check reads 'checked'", () => {
    assert.equal(rowTrustChip(job("clear", ago(STALE_CHECK_MS + 1)), NOW), "checked");
});

test("rowTrustChip: clear + no check timestamp reads 'checked' (missing is stale)", () => {
    assert.equal(rowTrustChip(job("clear", null), NOW), "checked");
});

/** Same class as the badgeFor case above, at the chip: a scrape minutes old
 *  must not launder a 90-day-old verdict into "verified". */
test("rowTrustChip: a fresh scrape with a 90-day-old check reads 'checked', not 'verified'", () => {
    assert.equal(rowTrustChip(job("clear", ago(90 * 86_400_000), ago(60_000)), NOW), "checked");
});

test("rowTrustChip: caution reads 'review'", () => {
    assert.equal(rowTrustChip(job("caution", null), NOW), "review");
});

test("rowTrustChip: likely_ghost reads 'ghost'", () => {
    assert.equal(rowTrustChip(job("likely_ghost", null), NOW), "ghost");
});

// Vivek, 2026-08-17: "view all ...but obviously mark the ghost jobs". The two
// flagged verdicts shared the amber "review" chip, so the row said the same
// word about "worth a quick sanity-check" and about "flagged as a possible
// ghost job" — the same collapse `ghostBadgeTone` (lib/ui/status-tokens.ts)
// was written to undo for the radar bars, still standing on the row where a
// reader decides whether to open a posting. It stopped being cosmetic when
// `/co`'s CTA started carrying `ghosts=show`: filtering used to do the
// marking, and once the filter is off the mark has to be real.
test("rowTrustChip: the two flagged verdicts are DISTINCT chips — no age or check state collapses them", () => {
    for (const checkedAt of [ago(30_000), ago(STALE_CHECK_MS + 1), null]) {
        assert.notEqual(
            rowTrustChip(job("likely_ghost", checkedAt), NOW),
            rowTrustChip(job("caution", checkedAt), NOW),
        );
    }
});

/**
 * Deliberate asymmetry, asserted so it can't be "tidied" away: a warning does
 * not decay. Staleness demotes a positive claim (clear → checked) because a
 * stale reassurance is dangerous; it must NOT soften a warning, because a
 * user losing the warning is the worse failure. The age disclosure for warn
 * states lives in the detail copy instead (`ghostMetaFor`, presentation.ts).
 * Each warning keeps its OWN chip at any age — not-decaying and
 * staying-distinct are separate promises, and collapsing to one word would
 * satisfy this one while breaking the other.
 */
test("rowTrustChip: each warning keeps its own chip however old the check is", () => {
    assert.equal(rowTrustChip(job("caution", ago(400 * 86_400_000)), NOW), "review");
    assert.equal(rowTrustChip(job("likely_ghost", ago(400 * 86_400_000)), NOW), "ghost");
});

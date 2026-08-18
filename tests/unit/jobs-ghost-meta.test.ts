import { test } from "node:test";
import assert from "node:assert/strict";
import { GHOST_META, STALE_CLEAR_META, ghostMetaFor } from "../../src/lib/jobs/presentation";
import { STALE_CHECK_DAYS } from "../../src/lib/jobs/freshness";
import type { GhostBadge } from "../../src/lib/jobs/types";

const NOW = Date.parse("2026-08-17T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const job = (ghost_badge: GhostBadge, ghost_checked_at: string | null) => ({ ghost_badge, ghost_checked_at });

const FRESH = daysAgo(1);
const STALE = daysAgo(STALE_CHECK_DAYS + 1);

/* -------- a current check renders the verdict exactly as authored -------- */

test("a fresh check returns the unmodified GHOST_META entry — no disclosure clause bolted on", () => {
    for (const badge of ["clear", "caution", "likely_ghost"] as const) {
        assert.deepEqual(ghostMetaFor(job(badge, FRESH), NOW), GHOST_META[badge]);
    }
});

test("unscored has no verdict to qualify, stale or not", () => {
    assert.equal(ghostMetaFor(job("unscored", FRESH), NOW), null);
    assert.equal(ghostMetaFor(job("unscored", STALE), NOW), null);
    assert.equal(ghostMetaFor(job("unscored", null), NOW), null);
});

/* ------------- staleness job 1: DEMOTE a stale positive claim ------------- */

test("a stale 'clear' loses the green no-ghost-signals claim", () => {
    const meta = ghostMetaFor(job("clear", STALE), NOW)!;
    assert.equal(meta.label, STALE_CLEAR_META.label);
    assert.notEqual(meta.label, GHOST_META.clear!.label);
    assert.equal(meta.cls, STALE_CLEAR_META.cls);
});

/* ---------- staleness job 2: DATE every other stale verdict --------------- */

/**
 * The reported bug (2026-08-17): a modal read "WORTH VERIFYING · checked 89d
 * ago" with copy in the present tense — "some signals suggest this posting
 * is worth a quick sanity-check" — because staleness was wired to the
 * `clear` branch ONLY. Every other verdict was exempt, so an 89-day-old
 * caution rendered identically to one from this morning.
 */
test("a stale 'caution' keeps its warning but discloses when the check ran", () => {
    const meta = ghostMetaFor(job("caution", daysAgo(89)), NOW)!;
    assert.equal(meta.label, GHOST_META.caution!.label, "the warning itself must not be softened");
    assert.ok(meta.explain.startsWith(GHOST_META.caution!.explain), "original copy is kept, not replaced");
    assert.match(meta.explain, /Last checked 89d ago\./);
});

/** The class, not the instance: the same rule must hold for the other warn
 *  state, which the reported screenshot never exercised. */
test("a stale 'likely_ghost' keeps its warning and discloses the check age too", () => {
    const meta = ghostMetaFor(job("likely_ghost", daysAgo(212)), NOW)!;
    assert.equal(meta.label, GHOST_META.likely_ghost!.label);
    assert.match(meta.explain, /Last checked 212d ago\./);
});

test("a stale 'clear' is dated as well as demoted", () => {
    const meta = ghostMetaFor(job("clear", daysAgo(47)), NOW)!;
    assert.equal(meta.label, STALE_CLEAR_META.label);
    assert.match(meta.explain, /Last checked 47d ago\./);
});

/* ---------------------- an undatable check says so ------------------------ */

test("no check timestamp states the absence instead of inventing an age", () => {
    for (const badge of ["clear", "caution", "likely_ghost"] as const) {
        const meta = ghostMetaFor(job(badge, null), NOW)!;
        assert.match(meta.explain, /no record of when it was last checked/);
        assert.doesNotMatch(meta.explain, /Last checked/);
    }
});

test("a document predating ghost_checked_at is treated as undatable, never as fresh", () => {
    const meta = ghostMetaFor({ ghost_badge: "clear" }, NOW)!;
    assert.equal(meta.label, STALE_CLEAR_META.label);
    assert.match(meta.explain, /no record of when it was last checked/);
});

/* ------------------------- the two clocks stay apart ---------------------- */

/**
 * `updated_at` is not an input here and must never become one again: a
 * posting re-scraped this morning whose check last ran 90 days ago is stale.
 * `GhostChecked` doesn't even carry `updated_at`, so this is a regression
 * guard on the seam rather than on the arithmetic.
 */
test("a fresh scrape cannot refresh a stale verdict", () => {
    const meta = ghostMetaFor(
        { ghost_badge: "clear", ghost_checked_at: daysAgo(90), updated_at: daysAgo(0) } as never,
        NOW,
    )!;
    assert.equal(meta.label, STALE_CLEAR_META.label);
    assert.match(meta.explain, /Last checked 90d ago\./);
});

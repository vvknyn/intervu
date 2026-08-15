import { test } from "node:test";
import assert from "node:assert/strict";
import {
    sanitizeTimestamp,
    classifyPostingFreshness,
    FRESH_WINDOW_MS,
    RELIST_MARGIN_MS,
} from "../../src/lib/jobs/posting-freshness";

const NOW = Date.parse("2026-07-23T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

/* --------------------------- sanitizeTimestamp --------------------------- */

test("sanitizeTimestamp parses a sane ISO string", () => {
    assert.equal(sanitizeTimestamp(ago(0), NOW), NOW);
});

test("sanitizeTimestamp treats null/undefined as no data", () => {
    assert.equal(sanitizeTimestamp(null, NOW), null);
    assert.equal(sanitizeTimestamp(undefined, NOW), null);
});

test("sanitizeTimestamp rejects unparseable strings", () => {
    assert.equal(sanitizeTimestamp("not-a-date", NOW), null);
});

test("sanitizeTimestamp rejects pre-2000 junk", () => {
    assert.equal(sanitizeTimestamp("1970-01-01T00:00:00Z", NOW), null);
});

test("sanitizeTimestamp rejects far-future sentinels beyond the 24h grace", () => {
    assert.equal(sanitizeTimestamp("2030-01-31T00:00:00Z", NOW), null);
});

test("sanitizeTimestamp accepts within the 24h future clock-skew grace", () => {
    const t = NOW + 60_000;
    assert.equal(sanitizeTimestamp(new Date(t).toISOString(), NOW), t);
});

/* ------------------------- classifyPostingFreshness ------------------------- */

test("fresh: first seen within the 7d window, posted_at absent", () => {
    const r = classifyPostingFreshness({ posted_at: null, first_seen_at: ago(2 * 86_400_000) }, NOW);
    assert.equal(r.kind, "fresh");
    assert.equal(r.postedMs, null);
    assert.equal(r.firstSeenMs, NOW - 2 * 86_400_000);
});

test("relisted: posted_at claims a date >= the relist margin after first_seen_at", () => {
    const firstSeen = ago(40 * 86_400_000);
    const posted = ago(40 * 86_400_000 - RELIST_MARGIN_MS); // exactly the margin later
    const r = classifyPostingFreshness({ posted_at: posted, first_seen_at: firstSeen }, NOW);
    assert.equal(r.kind, "relisted");
});

test("boundary: exactly at the relist margin counts as relisted (>=)", () => {
    const firstSeenMs = NOW - 30 * 86_400_000;
    const postedMs = firstSeenMs + RELIST_MARGIN_MS;
    const r = classifyPostingFreshness(
        { posted_at: new Date(postedMs).toISOString(), first_seen_at: new Date(firstSeenMs).toISOString() },
        NOW,
    );
    assert.equal(r.kind, "relisted");
});

test("boundary: 1ms under the relist margin does not count as relisted", () => {
    const firstSeenMs = NOW - 30 * 86_400_000;
    const postedMs = firstSeenMs + RELIST_MARGIN_MS - 1;
    const r = classifyPostingFreshness(
        { posted_at: new Date(postedMs).toISOString(), first_seen_at: new Date(firstSeenMs).toISOString() },
        NOW,
    );
    assert.notEqual(r.kind, "relisted");
});

// ITEM T (2026-08-15) — the margin dropped from 14d to 3d because a real
// 6-day relist gap Vivek found live went undetected under the old, too-
// generous threshold. These pin the two concrete gaps that motivated the
// change, independent of the symbolic RELIST_MARGIN_MS boundary tests above.
test("ITEM T: a real 6-day posted-vs-first-seen gap reads as relisted", () => {
    const firstSeenMs = NOW - 13 * 86_400_000;
    const postedMs = NOW - 7 * 86_400_000; // 6 days after first_seen
    const r = classifyPostingFreshness(
        { posted_at: new Date(postedMs).toISOString(), first_seen_at: new Date(firstSeenMs).toISOString() },
        NOW,
    );
    assert.equal(r.kind, "relisted");
});

test("ITEM T: a 2-day gap (date-only/timezone stamping noise floor) does not read as relisted", () => {
    const firstSeenMs = NOW - 30 * 86_400_000;
    const postedMs = firstSeenMs + 2 * 86_400_000;
    const r = classifyPostingFreshness(
        { posted_at: new Date(postedMs).toISOString(), first_seen_at: new Date(firstSeenMs).toISOString() },
        NOW,
    );
    assert.notEqual(r.kind, "relisted");
});

test("null posted_at with an old first_seen_at (outside fresh window) yields no badge, not relisted", () => {
    const r = classifyPostingFreshness({ posted_at: null, first_seen_at: ago(FRESH_WINDOW_MS + 86_400_000) }, NOW);
    assert.equal(r.kind, null);
});

test("junk future posted_at (2030 sentinel) sanitizes away — never reads as relisted", () => {
    const r = classifyPostingFreshness(
        { posted_at: "2030-01-31T00:00:00Z", first_seen_at: ago(2 * 86_400_000) },
        NOW,
    );
    assert.notEqual(r.kind, "relisted");
    assert.equal(r.postedMs, null);
    // first_seen_at is within the fresh window, so this still reads as fresh —
    // absence of a usable posted_at claim doesn't erase the first-seen signal.
    assert.equal(r.kind, "fresh");
});

test("pre-2000 junk posted_at sanitizes away — never reads as relisted", () => {
    const r = classifyPostingFreshness(
        { posted_at: "1999-01-01T00:00:00Z", first_seen_at: ago(2 * 86_400_000) },
        NOW,
    );
    assert.notEqual(r.kind, "relisted");
    assert.equal(r.postedMs, null);
});

test("both null yields no badge at all", () => {
    const r = classifyPostingFreshness({ posted_at: null, first_seen_at: null }, NOW);
    assert.deepEqual(r, { kind: null, firstSeenMs: null, postedMs: null });
});

test("neither fresh nor relisted: both dates old and posted_at close to first_seen_at", () => {
    const firstSeen = ago(60 * 86_400_000);
    const posted = ago(59 * 86_400_000); // 1 day after first_seen — well under the relist margin
    const r = classifyPostingFreshness({ posted_at: posted, first_seen_at: firstSeen }, NOW);
    assert.equal(r.kind, null);
});

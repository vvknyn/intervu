import { test } from "node:test";
import assert from "node:assert/strict";
import { rowAgeChipLabel } from "../../src/lib/jobs/presentation";
import type { PublicJob } from "../../src/lib/jobs/types";

/**
 * `rowAgeChipLabel` is the sort-aware chip the /jobs list row renders (see
 * src/app/jobs/page.tsx's JobCard). Under FRESHEST (`effectiveSort ===
 * "newest"`, sort.ts's `resolveEffectiveSort` — also the empty-query
 * default) the underlying sort ranks on `first_seen_at:desc`, so the chip
 * switches to a discovery-age label to match; every other sort tab keeps
 * the existing posted-date chip.
 */

const NOW = Date.parse("2026-08-13T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

const job = (over: Partial<PublicJob>): PublicJob =>
    ({
        posted_at: null,
        first_seen_at: null,
        work_type: "unknown",
        employment_type: "unknown",
        experience_level: "unknown",
        salary_min: null,
        salary_max: null,
        salary_currency: null,
        salary_period: null,
        ...over,
    }) as PublicJob;

test("newest sort: an 8-day-old posted_at with a first_seen_at of today reads as discovery age, not posted age", () => {
    // The live-probe case: a freshly scraped board carried an older
    // employer-claimed date. FRESHEST must not read as a broken sort.
    const j = job({ posted_at: daysAgo(8), first_seen_at: daysAgo(0) });
    assert.equal(rowAgeChipLabel(j, "newest", NOW), "added today");
});

test("newest sort: null first_seen_at falls back to the posted-date chip — never blank, never fabricated", () => {
    const j = job({ posted_at: daysAgo(8), first_seen_at: null });
    assert.equal(rowAgeChipLabel(j, "newest", NOW), "8d ago");
});

test("relevance sort: posted-date chip unchanged even when first_seen_at is today", () => {
    const j = job({ posted_at: daysAgo(8), first_seen_at: daysAgo(0) });
    assert.equal(rowAgeChipLabel(j, "relevance", NOW), "8d ago");
});

test("salary_desc sort: posted-date chip unchanged even when first_seen_at is today", () => {
    const j = job({ posted_at: daysAgo(8), first_seen_at: daysAgo(0) });
    assert.equal(rowAgeChipLabel(j, "salary_desc", NOW), "8d ago");
});

test("newest sort: an unsanitizable first_seen_at (future sentinel) falls back to the posted-date chip", () => {
    const j = job({ posted_at: daysAgo(3), first_seen_at: "2030-01-31T00:00:00Z" });
    assert.equal(rowAgeChipLabel(j, "newest", NOW), "3d ago");
});

test("newest sort: both dates null yields no chip at all — not a blank string, not a fabricated date", () => {
    const j = job({ posted_at: null, first_seen_at: null });
    assert.equal(rowAgeChipLabel(j, "newest", NOW), null);
});

test("newest sort: discovery age buckets past 'today' the same way postedAgeShort buckets — e.g. 11 days", () => {
    const j = job({ posted_at: daysAgo(40), first_seen_at: daysAgo(11) });
    assert.equal(rowAgeChipLabel(j, "newest", NOW), "added 11d ago");
});

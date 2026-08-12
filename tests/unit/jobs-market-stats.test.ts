/**
 * The bug these guard against was a CONFIDENT ZERO: /trends printed "0 closed
 * to date" from a query that could only ever return 0, and nothing downstream
 * could tell that apart from a real measurement.
 *
 * So the load-bearing cases are the ones where data is missing. Every one of
 * them must yield `null` — "we don't know" — and never a zeroed object, which
 * would restore the original bug through a new pipe.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMarketStatsDoc } from "../../src/lib/jobs/market-stats";

const doc = {
  id: "global",
  window_days: 90,
  closed_90d: 868315,
  opened_90d: 1798349,
  live_postings: 1581518,
  companies_tracked: 39897,
  source_computed_at: "2026-08-12T03:43:08.472Z",
};

describe("parseMarketStatsDoc", () => {
  it("maps a complete document", () => {
    assert.deepEqual(parseMarketStatsDoc(doc), {
      windowDays: 90,
      closed: 868315,
      opened: 1798349,
      livePostings: 1581518,
      companiesTracked: 39897,
      sourceComputedAt: "2026-08-12T03:43:08.472Z",
    });
  });

  it("accepts numeric strings", () => {
    // The publisher coerces, but a hand-written or re-serialized doc may not.
    const parsed = parseMarketStatsDoc({ ...doc, closed_90d: "868315" });
    assert.equal(parsed?.closed, 868315);
  });

  it("keeps a legitimately-zero total", () => {
    // Zero is only a lie when it was never measured. A real 0 must survive.
    assert.equal(parseMarketStatsDoc({ ...doc, closed_90d: 0 })?.closed, 0);
  });

  it("returns null when the index or document is absent", () => {
    for (const absent of [null, undefined, "", 0]) {
      assert.equal(parseMarketStatsDoc(absent), null);
    }
  });

  it("returns null for a Meilisearch error body rather than reading fields off it", () => {
    // A 404 body is a plain object and would otherwise parse to all-nulls.
    assert.equal(parseMarketStatsDoc({ message: "Index `market_stats` not found.", code: "index_not_found" }), null);
  });

  it("rejects a PARTIAL document rather than reporting the half it got", () => {
    // Guards every field, not just the `closed` one that surfaced the bug:
    // a publisher writing an unexpected shape must not half-render.
    for (const key of ["closed_90d", "opened_90d", "live_postings", "companies_tracked", "window_days"]) {
      assert.equal(parseMarketStatsDoc({ ...doc, [key]: null }), null, `${key}=null should reject`);
      assert.equal(parseMarketStatsDoc({ ...doc, [key]: "n/a" }), null, `${key}="n/a" should reject`);
      const { [key]: _omitted, ...missing } = doc as Record<string, unknown>;
      assert.equal(parseMarketStatsDoc(missing), null, `${key} missing should reject`);
    }
  });

  it("treats a missing source timestamp as unknown, not as a failure", () => {
    // Freshness is nice-to-have; the totals are the product.
    assert.equal(parseMarketStatsDoc({ ...doc, source_computed_at: null })?.sourceComputedAt, null);
    assert.equal(parseMarketStatsDoc({ ...doc, source_computed_at: 12345 })?.sourceComputedAt, null);
    assert.equal(parseMarketStatsDoc({ ...doc, source_computed_at: null })?.closed, 868315);
  });

  it("carries the window so the UI cannot relabel 90 days as all-time", () => {
    assert.equal(parseMarketStatsDoc({ ...doc, window_days: 30 })?.windowDays, 30);
  });
});

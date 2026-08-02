import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveProofBandStats } from "../../src/components/marketing/proof-band";
import type { MarketTrendsData } from "../../src/lib/jobs/market-trends";

/** Minimal `MarketTrendsData` fixture — only the fields `deriveProofBandStats`
 *  reads (`liveJobs`, `ghostFlaggedLive`, `ghostRadar`) are load-bearing. */
function fixture(overrides: Partial<MarketTrendsData>): MarketTrendsData {
    return {
        liveJobs: { kind: "exact", value: 1000 },
        totalTracked: { kind: "exact", value: 2000 },
        ghostFlaggedLive: { kind: "exact", value: 50 },
        topCountries: [],
        freshness: [],
        ghostRadar: [
            { badge: "clear", count: { kind: "exact", value: 700 } },
            { badge: "caution", count: { kind: "exact", value: 100 } },
            { badge: "likely_ghost", count: { kind: "exact", value: 50 } },
            { badge: "unscored", count: { kind: "exact", value: 150 } },
        ],
        ...overrides,
    };
}

/* ------------------------------ deriveProofBandStats ------------------------------ */

test("deriveProofBandStats returns null when the source data is null", () => {
    assert.equal(deriveProofBandStats(null), null);
});

test("deriveProofBandStats computes screened share as 100 minus the unscored percentage", () => {
    const stats = deriveProofBandStats(fixture({}));
    assert.ok(stats);
    assert.equal(stats.liveJobs.value, 1000);
    assert.equal(stats.flaggedCount.value, 50);
    // 150 unscored / 1000 total = 15% unscored -> 85% screened.
    assert.equal(stats.screenedSharePct, 85);
});

test("deriveProofBandStats never divides by zero when there are no live jobs", () => {
    const stats = deriveProofBandStats(
        fixture({
            liveJobs: { kind: "exact", value: 0 },
            ghostRadar: [
                { badge: "clear", count: { kind: "exact", value: 0 } },
                { badge: "caution", count: { kind: "exact", value: 0 } },
                { badge: "likely_ghost", count: { kind: "exact", value: 0 } },
                { badge: "unscored", count: { kind: "exact", value: 0 } },
            ],
        }),
    );
    assert.ok(stats);
    assert.equal(stats.screenedSharePct, 0);
    assert.ok(!Number.isNaN(stats.screenedSharePct));
});

test("deriveProofBandStats rounds a fractional screened share to a whole number", () => {
    const stats = deriveProofBandStats(
        fixture({
            liveJobs: { kind: "exact", value: 3 },
            ghostRadar: [
                { badge: "clear", count: { kind: "exact", value: 2 } },
                { badge: "caution", count: { kind: "exact", value: 0 } },
                { badge: "likely_ghost", count: { kind: "exact", value: 0 } },
                { badge: "unscored", count: { kind: "exact", value: 1 } },
            ],
        }),
    );
    assert.ok(stats);
    // 1 unscored / 3 total = 33.33% unscored -> 66.67% screened -> rounds to 67.
    assert.equal(stats.screenedSharePct, 67);
});

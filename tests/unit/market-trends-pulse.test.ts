import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeStaleActiveSharePct } from '../../src/lib/jobs/market-trends';

// /trends' "of live roles, N% have been open 60+ days" stat — a truth-data
// angle the competitor's raw feed can't frame. `olderThan60d` is, by
// construction, the freshness band's "older" bucket count: a query already
// scoped to ACTIVE_FILTER, so it's always <= activeTotal (see market-trends.ts).
describe('computeStaleActiveSharePct', () => {
    it('rounds to the nearest whole percent', () => {
        assert.equal(computeStaleActiveSharePct(1000, 333), 33);
        assert.equal(computeStaleActiveSharePct(1000, 335), 34);
    });

    it('100% when every active posting is older than 60 days', () => {
        assert.equal(computeStaleActiveSharePct(500, 500), 100);
    });

    it('0% when none are', () => {
        assert.equal(computeStaleActiveSharePct(500, 0), 0);
    });

    it('zero-active division class case — returns 0, not NaN/Infinity', () => {
        assert.equal(computeStaleActiveSharePct(0, 0), 0);
        assert.equal(Number.isFinite(computeStaleActiveSharePct(0, 0)), true);
    });

    it('negative/degenerate activeTotal also falls back to 0 rather than a fabricated percent', () => {
        assert.equal(computeStaleActiveSharePct(-1, 5), 0);
    });
});

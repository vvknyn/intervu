import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBeyondWindow, formatBeyondWindowText } from '../../src/lib/jobs/beyond-window';
import type { CorpusCount } from '../../src/lib/jobs/corpus-count';

const exact = (value: number): CorpusCount => ({ kind: 'exact', value });
const floor = (value: number): CorpusCount => ({ kind: 'floor', value });

// The surfacing instance (2026-08-12 measurement, under the then-30d
// default): the window showed 2,294 while the any-bucket corpus held 7,199
// matching roles — 4,905 hidden. The default is 90d since 2026-09-30
// (`DEFAULT_URL_STATE.postedBucket`), and the rule follows the default.
describe('resolveBeyondWindow', () => {
    it('the surfacing instance — default 90d active, real hidden inventory beyond it', () => {
        assert.deepEqual(resolveBeyondWindow('90d', exact(2_294), exact(7_199)), {
            show: true,
            extra: 4_905,
        });
    });

    it('bucket=7d — no affordance even though beyondCount is far higher (rule only applies to the default window)', () => {
        assert.deepEqual(resolveBeyondWindow('7d', exact(400), exact(7_199)), { show: false, extra: null });
    });

    it('bucket=30d — an explicit narrower pick now, not the default — no affordance', () => {
        assert.deepEqual(resolveBeyondWindow('30d', exact(2_294), exact(7_199)), { show: false, extra: null });
    });

    it('bucket=undefined ("Any" already active) — no affordance, there is nothing further to reveal', () => {
        assert.deepEqual(resolveBeyondWindow(undefined, exact(7_199), exact(7_199)), { show: false, extra: null });
    });

    it('probe unresolved (null) — no affordance rather than a stale/guessed number', () => {
        assert.deepEqual(resolveBeyondWindow('90d', exact(2_294), null), { show: false, extra: null });
    });

    it('current count unresolved (null) — no affordance', () => {
        assert.deepEqual(resolveBeyondWindow('90d', null, exact(7_199)), { show: false, extra: null });
    });

    it('beyond <= current — no affordance (filters already show everything there is)', () => {
        assert.deepEqual(resolveBeyondWindow('90d', exact(2_294), exact(2_294)), { show: false, extra: null });
    });

    it('a legitimate zero — probe succeeds and correctly measures nothing hidden', () => {
        assert.deepEqual(resolveBeyondWindow('90d', exact(0), exact(0)), { show: false, extra: null });
    });

    it('floor on the beyond side — show the affordance without a number rather than a wrong one', () => {
        assert.deepEqual(resolveBeyondWindow('90d', exact(2_294), floor(100_000)), {
            show: true,
            extra: null,
        });
    });

    it('floor on the current side — same rule applies regardless of which side capped', () => {
        assert.deepEqual(resolveBeyondWindow('90d', floor(100_000), floor(100_000)), {
            show: true,
            extra: null,
        });
    });

    it('probe not yet resolved (undefined) — same hidden decision as null, for the show/extra call', () => {
        assert.deepEqual(resolveBeyondWindow('90d', exact(2_294), undefined), { show: false, extra: null });
    });
});

// Prod regression, 2026-09-17: the anonymous /jobs landing (no query — the
// "beyond 30 days" (then the default) population is the WHOLE corpus, no facets requested on
// that probe — see page.tsx's beyond-window probe) rendered the bare
// fragment "more roles beyond 30 days · Show all" with no number, because
// `resolveBeyondWindow`'s legitimate `{ show: true, extra: null }` floor
// case and its `undefined` (not-yet-resolved) case both used to collapse
// into the same blank spot. A sentence naming a count must never render
// without the count.
describe('formatBeyondWindowText', () => {
    it('not resolved yet for this search — renders nothing (caller reserves the line height)', () => {
        assert.equal(formatBeyondWindowText(undefined), null);
    });

    it('a legitimate zero (or negative) — renders nothing, there is nothing beyond', () => {
        assert.equal(formatBeyondWindowText(0), null);
        assert.equal(formatBeyondWindowText(-3), null);
    });

    it('the surfaced case — resolved but uncountable (floor on either side) — an honest sentence, never a hole, parallel to the counted form', () => {
        assert.equal(formatBeyondWindowText(null), 'More roles beyond 90 days');
    });

    it('a resolved exact count — the counted sentence', () => {
        assert.equal(formatBeyondWindowText(6_977), '6,977 more beyond 90 days');
    });
});

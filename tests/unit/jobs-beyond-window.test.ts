import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBeyondWindow } from '../../src/lib/jobs/beyond-window';
import type { CorpusCount } from '../../src/lib/jobs/corpus-count';

const exact = (value: number): CorpusCount => ({ kind: 'exact', value });
const floor = (value: number): CorpusCount => ({ kind: 'floor', value });

// The surfacing instance (2026-08-12 measurement): 30d shows 2,294 while the
// any-bucket corpus holds 7,199 matching roles — 4,905 hidden.
describe('resolveBeyondWindow', () => {
    it('the surfacing instance — 30d active, real hidden inventory beyond it', () => {
        assert.deepEqual(resolveBeyondWindow('30d', exact(2_294), exact(7_199)), {
            show: true,
            extra: 4_905,
        });
    });

    it('bucket=7d — no affordance even though beyondCount is far higher (rule only applies to the 30d default)', () => {
        assert.deepEqual(resolveBeyondWindow('7d', exact(400), exact(7_199)), { show: false, extra: null });
    });

    it('bucket=undefined ("Any" already active) — no affordance, there is nothing further to reveal', () => {
        assert.deepEqual(resolveBeyondWindow(undefined, exact(7_199), exact(7_199)), { show: false, extra: null });
    });

    it('probe unresolved (null) — no affordance rather than a stale/guessed number', () => {
        assert.deepEqual(resolveBeyondWindow('30d', exact(2_294), null), { show: false, extra: null });
    });

    it('current count unresolved (null) — no affordance', () => {
        assert.deepEqual(resolveBeyondWindow('30d', null, exact(7_199)), { show: false, extra: null });
    });

    it('beyond <= current — no affordance (filters already show everything there is)', () => {
        assert.deepEqual(resolveBeyondWindow('30d', exact(2_294), exact(2_294)), { show: false, extra: null });
    });

    it('a legitimate zero — probe succeeds and correctly measures nothing hidden', () => {
        assert.deepEqual(resolveBeyondWindow('30d', exact(0), exact(0)), { show: false, extra: null });
    });

    it('floor on the beyond side — show the affordance without a number rather than a wrong one', () => {
        assert.deepEqual(resolveBeyondWindow('30d', exact(2_294), floor(100_000)), {
            show: true,
            extra: null,
        });
    });

    it('floor on the current side — same rule applies regardless of which side capped', () => {
        assert.deepEqual(resolveBeyondWindow('30d', floor(100_000), floor(100_000)), {
            show: true,
            extra: null,
        });
    });
});

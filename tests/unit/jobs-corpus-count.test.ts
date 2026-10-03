import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCorpusCount, resolveLiveCorpusCount, formatCorpusCount, formatCompactCorpusCount, CORPUS_COUNT_CAP, type CorpusCount } from '../../src/lib/jobs/corpus-count';

// Whole-branch review finding: the app must never present a Meilisearch
// maxTotalHits-capped `total` as an exact fact. `resolveCorpusCount` is the
// one chokepoint the four display sites (search placeholder, result count,
// résumé-upsell card, end-of-list line — jobs/page.tsx) resolve through
// instead of reading `.total` directly.
describe('resolveCorpusCount', () => {
    it('total below the cap — exact, straight from total (the common case)', () => {
        assert.deepEqual(resolveCorpusCount({ total: 42_318 }), { kind: 'exact', value: 42_318 });
    });

    it('total at the cap WITH a ghost_badge facet distribution — honest summed count, not the capped value', () => {
        const result = {
            total: CORPUS_COUNT_CAP,
            facetDistribution: {
                ghost_badge: { clear: 1_331_804, caution: 329_922, unscored: 65_045, likely_ghost: 43_095 },
            },
        };
        assert.deepEqual(resolveCorpusCount(result), { kind: 'exact', value: 1_769_866 });
    });

    it('total at the cap with NO facets at all — floor, not a bare number', () => {
        assert.deepEqual(resolveCorpusCount({ total: CORPUS_COUNT_CAP }), {
            kind: 'floor',
            value: CORPUS_COUNT_CAP,
        });
    });

    it('total at the cap with a facetDistribution present but no ghost_badge key — still a floor', () => {
        const result = { total: CORPUS_COUNT_CAP, facetDistribution: { source: { linkedin: 500 } } };
        assert.deepEqual(resolveCorpusCount(result as never), { kind: 'floor', value: CORPUS_COUNT_CAP });
    });

    it('a tiny result (zero hits, zero total) stays exact zero, not a floor', () => {
        assert.deepEqual(resolveCorpusCount({ total: 0 }), { kind: 'exact', value: 0 });
    });

    it('respects a caller-supplied cap distinct from the module default', () => {
        assert.deepEqual(resolveCorpusCount({ total: 1_000 }, 1_000), { kind: 'floor', value: 1_000 });
        assert.deepEqual(resolveCorpusCount({ total: 999 }, 1_000), { kind: 'exact', value: 999 });
    });
});

describe('formatCorpusCount', () => {
    it('exact — plain, comma-grouped, no suffix', () => {
        assert.equal(formatCorpusCount({ kind: 'exact', value: 1_769_866 }), '1,769,866');
    });

    it('exact, un-capped four-digit count — comma-grouped, matches the "9184" -> "9,184" regression', () => {
        assert.equal(formatCorpusCount({ kind: 'exact', value: 9_184 }), '9,184');
    });

    it('floor — comma-grouped with a trailing "+" (a true floor, never a bare number)', () => {
        assert.equal(formatCorpusCount({ kind: 'floor', value: CORPUS_COUNT_CAP }), '100,000+');
    });

    it('exact zero renders as "0", not blank', () => {
        const zero: CorpusCount = { kind: 'exact', value: 0 };
        assert.equal(formatCorpusCount(zero), '0');
    });
});

describe('formatCompactCorpusCount', () => {
    it('millions — one decimal and "mil"', () => {
        assert.equal(formatCompactCorpusCount({ kind: 'exact', value: 2_062_887 }), '~2.1 mil');
    });

    it('hundreds of thousands — rounded k', () => {
        assert.equal(formatCompactCorpusCount({ kind: 'exact', value: 820_000 }), '~820k');
    });

    it('floor keeps trailing plus', () => {
        assert.equal(formatCompactCorpusCount({ kind: 'floor', value: CORPUS_COUNT_CAP }), '~100k+');
    });
});

// Gate thread finding (2026-10-01): a search-index outage came back as zero
// hits, the board's "new since your last visit" count cached it as an exact
// 0 for 15 minutes, and nobody in that country saw the line until it expired.
describe('resolveLiveCorpusCount (counts that get cached)', () => {
    it('a failed search throws, so unstable_cache keeps nothing', () => {
        assert.throws(() => resolveLiveCorpusCount({ total: 0, unavailable: true }), /unavailable/);
    });

    it('a search that is not set up throws too', () => {
        assert.throws(() => resolveLiveCorpusCount({ total: 0, configured: false }), /unavailable/);
    });

    it('a real zero is still an exact zero', () => {
        assert.deepEqual(resolveLiveCorpusCount({ total: 0, configured: true }), { kind: 'exact', value: 0 });
    });

    it('a working search resolves like resolveCorpusCount', () => {
        assert.deepEqual(resolveLiveCorpusCount({ total: 1_234 }), { kind: 'exact', value: 1_234 });
        assert.deepEqual(resolveLiveCorpusCount({ total: CORPUS_COUNT_CAP }), { kind: 'floor', value: CORPUS_COUNT_CAP });
    });
});

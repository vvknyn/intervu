import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fitRankUrlState, keepsTypedQuery, type FitApplication } from '../../src/lib/jobs/for-you/pack-filters';
import { DEFAULT_URL_STATE } from '../../src/lib/jobs/url-state';

const fit: FitApplication = { q: 'product manager', facets: { country: ['Canada'] } as FitApplication['facets'], postedBucket: '30d', keepUserWindow: false };

describe('rank by fit keeps what the visitor typed (I3)', () => {
    for (const q of ['data engineer', '  "staff" nurse ']) {
        it(`typed "${q.trim()}": q and filters stay, only sort=fit is added`, () => {
            const base = { ...DEFAULT_URL_STATE, q, facets: { country: ['Germany'] } as FitApplication['facets'], postedBucket: '7d' as const };
            const next = fitRankUrlState(base, fit);
            assert.deepEqual(next, { ...base, sort: 'fit' });
            assert.ok(keepsTypedQuery(base));
        });
    }
    it('bare board: the pack query, facets and window apply', () => {
        const next = fitRankUrlState(DEFAULT_URL_STATE, fit);
        assert.equal(next.q, 'product manager');
        assert.equal(next.sort, 'fit');
        assert.deepEqual(next.facets, fit.facets);
        assert.equal(next.postedBucket, '30d');
        assert.ok(!keepsTypedQuery({ ...DEFAULT_URL_STATE, q: '   ' }));
    });
});

import { FIT_SEARCH_PLACEHOLDER, SEARCH_PLACEHOLDER, searchBoxFor } from '../../src/lib/jobs/search-copy';

describe('the search box hides the résumé-derived query (I4)', () => {
    it('fit list on the pack query: empty box, "within your matches"', () => {
        assert.deepEqual(searchBoxFor('product manager', 'product manager', true, 'product manager'), { value: '', placeholder: FIT_SEARCH_PLACEHOLDER });
    });
    for (const [name, args] of [
        ['typed query in fit mode', ['nurse', 'nurse', true, 'product manager']],
        ['half-typed over the pack query', ['product manager x', 'product manager', true, 'product manager']],
        ['not fit mode', ['product manager', 'product manager', false, 'product manager']],
        ['no résumé yet', ['product manager', 'product manager', true, null]],
    ] as const) {
        it(`${name}: the draft shows`, () => {
            assert.deepEqual(searchBoxFor(args[0], args[1], args[2], args[3]), { value: args[0], placeholder: SEARCH_PLACEHOLDER });
        });
    }
});

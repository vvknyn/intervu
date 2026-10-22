import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fitRankUrlState, urlHasOwnIntent, type FitApplication } from '../../src/lib/jobs/for-you/pack-filters';
import { DEFAULT_URL_STATE } from '../../src/lib/jobs/url-state';

const fit: FitApplication = { q: 'product manager', facets: { country: ['Canada'] } as FitApplication['facets'], postedBucket: '30d', keepUserWindow: false };

describe('rank by fit keeps what the visitor typed (I3)', () => {
    for (const q of ['data engineer', '  "staff" nurse ']) {
        it(`typed "${q.trim()}": q and filters stay, only sort=fit is added`, () => {
            const base = { ...DEFAULT_URL_STATE, q, facets: { country: ['Germany'] } as FitApplication['facets'], postedBucket: '7d' as const };
            const next = fitRankUrlState(base, fit);
            assert.deepEqual(next, { ...base, sort: 'fit' });
            assert.ok(urlHasOwnIntent(base));
        });
    }
    it('bare board: the pack query, facets and window apply', () => {
        const next = fitRankUrlState(DEFAULT_URL_STATE, fit);
        assert.equal(next.q, 'product manager');
        assert.equal(next.sort, 'fit');
        assert.deepEqual(next.facets, fit.facets);
        assert.equal(next.postedBucket, '30d');
        assert.ok(!urlHasOwnIntent(DEFAULT_URL_STATE));
    });
    it('any other address with its own intent is ranked as is: nothing from the pack, every param kept', () => {
        const cases: Partial<typeof DEFAULT_URL_STATE>[] = [
            { companyDomain: 'harrods.com' },
            { board: 'greenhouse' as never },
            { facets: { work_type: ['remote'] } as FitApplication['facets'] },
            { postedBucket: '7d', postedExplicit: true },
            { jobId: 'abc' },
        ];
        for (const extra of cases) {
            const base = { ...DEFAULT_URL_STATE, ...extra };
            assert.ok(urlHasOwnIntent(base), JSON.stringify(extra));
            assert.deepEqual(fitRankUrlState(base, fit), { ...base, sort: 'fit' }, JSON.stringify(extra));
        }
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

import { resolveJobsEntry } from '../../src/lib/jobs/server-entry';

describe('the first frame carries the stored résumé (I5)', () => {
    const user = { uid: 'u1', email: 'a@b.co' };
    const bare = new URLSearchParams();
    const structured = { data: { profile: { name: 'A' } } as never, updatedAt: '2026-10-01' };
    const textOnly = { text: 'Jane Doe\nSenior PM', updatedAt: null };

    it('structured: redirects to the fit address', () => {
        assert.deepEqual(resolveJobsEntry({ user, search: bare, resumeOnFile: true, fitPath: '/jobs?q=pm&sort=fit', resume: structured }), { kind: 'redirect', url: '/jobs?q=pm&sort=fit' });
    });
    it('structured, on the fit address: renders with the résumé in initial', () => {
        const e = resolveJobsEntry({ user, search: new URLSearchParams('q=pm&sort=fit'), resumeOnFile: true, fitPath: '/jobs?q=pm&sort=fit', resume: structured });
        assert.deepEqual(e, { kind: 'render', initial: { user, resumeOnFile: true, resume: structured } });
    });
    it('text-only: renders (no redirect) and hands over the text, unstructured', () => {
        const e = resolveJobsEntry({ user, search: bare, resumeOnFile: true, fitPath: null, resume: textOnly });
        assert.equal(e.kind, 'render');
        if (e.kind === 'render') {
            assert.equal(e.initial?.resume?.text, textOnly.text);
            assert.equal(e.initial?.resume?.data, undefined);
        }
    });
    it('none or unknown: renders with no résumé', () => {
        for (const resumeOnFile of [false, null]) {
            const e = resolveJobsEntry({ user, search: bare, resumeOnFile, fitPath: null, resume: resumeOnFile === false ? {} : null });
            assert.deepEqual(e, { kind: 'render', initial: { user, resumeOnFile } });
        }
    });
});

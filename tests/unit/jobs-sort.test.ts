import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
    resolveEffectiveSort,
    buildMeiliSort,
    compareJobsBySort,
    coerceSortToSupported,
    shouldScopeTextMatchToTitle,
    isPageSorted,
    sortOptionLabel,
    sortTriggerLabel,
} from '../../src/lib/jobs/sort';
import { JOB_SORT_MODES } from '../../src/lib/jobs/types';
import type { PublicJob } from '../../src/lib/jobs/types';

function mkJob(overrides: Partial<PublicJob> & { id: string }): PublicJob {
    return {
        title: 'Engineer',
        company: 'Acme',
        company_domain: null,
        location: null,
        location_city: null,
        location_state: null,
        location_country: null,
        work_type: 'remote',
        description: null,
        employment_type: 'full_time',
        experience_level: 'mid',
        salary_min: null,
        salary_max: null,
        salary_currency: null,
        salary_period: null,
        visa_sponsorship: null,
        tags: [],
        apply_url: 'https://example.com',
        source: 'test',
        posted_at: '2026-01-01T00:00:00Z',
        first_seen_at: '2026-01-01T00:00:00Z',
        updated_at: null,
        vacancy_status: 'open',
        ghost_badge: 'unscored',
        ...overrides,
    };
}

describe('resolveEffectiveSort', () => {
    it('defaults to newest with no query and no explicit sort', () => {
        assert.equal(resolveEffectiveSort({}), 'newest');
    });

    it('defaults to relevance when a query is present', () => {
        assert.equal(resolveEffectiveSort({ q: 'designer' }), 'relevance');
    });

    it('falls back to newest when relevance is requested without a query', () => {
        assert.equal(resolveEffectiveSort({ sort: 'relevance' }), 'newest');
        assert.equal(resolveEffectiveSort({ sort: 'relevance', q: '   ' }), 'newest');
    });

    it('honors explicit salary_desc', () => {
        assert.equal(resolveEffectiveSort({ sort: 'salary_desc' }), 'salary_desc');
    });
});

describe('buildMeiliSort', () => {
    it('returns posted_ts:desc for newest', () => {
        assert.deepEqual(buildMeiliSort({ sort: 'newest' }), ['posted_ts:desc']);
    });

    it('returns undefined for relevance with a query', () => {
        assert.equal(buildMeiliSort({ sort: 'relevance', q: 'engineer' }), undefined);
    });

    it('returns salary sorts for salary_desc', () => {
        assert.deepEqual(buildMeiliSort({ sort: 'salary_desc' }), ['salary_max:desc', 'salary_min:desc']);
    });

    it('auto-defaults to posted_ts:desc without query', () => {
        assert.deepEqual(buildMeiliSort({}), ['posted_ts:desc']);
    });

    it('uses legacy posted_at field when requested', () => {
        assert.deepEqual(buildMeiliSort({ sort: 'newest' }, true), ['posted_at:desc']);
    });

    it('normalizes relevance-without-query to newest sort', () => {
        assert.deepEqual(buildMeiliSort({ sort: 'relevance' }), ['posted_ts:desc']);
    });
});

describe('shouldScopeTextMatchToTitle', () => {
    it('scopes an explicit non-relevance sort with a query', () => {
        assert.equal(shouldScopeTextMatchToTitle('newest', 'product manager'), true);
        assert.equal(shouldScopeTextMatchToTitle('salary_desc', 'product manager'), true);
    });

    it('leaves relevance unscoped regardless of query', () => {
        assert.equal(shouldScopeTextMatchToTitle('relevance', 'product manager'), false);
    });

    it('leaves a query-less request unscoped regardless of sort — nothing to scope', () => {
        assert.equal(shouldScopeTextMatchToTitle('newest', undefined), false);
        assert.equal(shouldScopeTextMatchToTitle('newest', ''), false);
        assert.equal(shouldScopeTextMatchToTitle('newest', '   '), false);
    });
});

describe('compareJobsBySort salary_desc', () => {
    it('orders higher salary_max first', () => {
        const high = mkJob({ id: 'a', salary_max: 200_000, salary_min: 150_000 });
        const low = mkJob({ id: 'b', salary_max: 100_000, salary_min: 80_000 });
        assert.ok(compareJobsBySort(high, low, 'salary_desc') < 0);
    });

    it('uses salary_min as tiebreaker when max is equal', () => {
        const a = mkJob({ id: 'a', salary_max: 150_000, salary_min: 120_000 });
        const b = mkJob({ id: 'b', salary_max: 150_000, salary_min: 100_000 });
        assert.ok(compareJobsBySort(a, b, 'salary_desc') < 0);
    });

    it('places null salaries last', () => {
        const paid = mkJob({ id: 'a', salary_max: 50_000 });
        const unpaid = mkJob({ id: 'b', salary_min: null, salary_max: null });
        assert.ok(compareJobsBySort(paid, unpaid, 'salary_desc') < 0);
        assert.ok(compareJobsBySort(unpaid, paid, 'salary_desc') > 0);
    });
});

describe('isPageSorted', () => {
    it('treats equal-ms ties as sorted — bulk-ingested docs legitimately share one posted_ts millisecond', () => {
        const a = mkJob({ id: 'a', posted_at: '2026-01-05T00:00:00Z' });
        const b = mkJob({ id: 'b', posted_at: '2026-01-05T00:00:00Z' });
        const c = mkJob({ id: 'c', posted_at: '2026-01-04T00:00:00Z' });
        assert.equal(isPageSorted([a, b, c], 'newest'), true);
    });

    it('flags an out-of-order newest page — the sort-integrity defect this guard exists for', () => {
        const newer = mkJob({ id: 'a', posted_at: '2026-01-05T00:00:00Z' });
        const older = mkJob({ id: 'b', posted_at: '2026-01-01T00:00:00Z' });
        const newerAgain = mkJob({ id: 'c', posted_at: '2026-01-06T00:00:00Z' });
        // newest-first with an order-restart in the middle — exactly the shape
        // `searchCutoffMs` produced on a partially-applied sort.
        assert.equal(isPageSorted([newer, older, newerAgain], 'newest'), false);
    });

    it('checks salary_desc order too, not just newest', () => {
        const high = mkJob({ id: 'a', salary_max: 200_000 });
        const low = mkJob({ id: 'b', salary_max: 100_000 });
        const higher = mkJob({ id: 'c', salary_max: 250_000 });
        assert.equal(isPageSorted([high, low], 'salary_desc'), true);
        assert.equal(isPageSorted([high, low, higher], 'salary_desc'), false);
    });

    it('an empty or single-hit page is trivially sorted', () => {
        assert.equal(isPageSorted([], 'newest'), true);
        assert.equal(isPageSorted([mkJob({ id: 'a' })], 'newest'), true);
    });
});

describe('coerceSortToSupported', () => {
    it('drops "newest" when the corpus carries no posted_ts', () => {
        // The bug this exists to prevent: posted_ts is absent on every document,
        // so `posted_ts:desc` sorts nothing while the toolbar claims "newest first".
        assert.equal(coerceSortToSupported('newest', false), 'relevance');
    });

    it('keeps "newest" once the field is populated — the fix self-heals', () => {
        assert.equal(coerceSortToSupported('newest', true), 'newest');
    });

    it('leaves every other mode untouched in both states', () => {
        // Class check: the coercion targets the one unsupported mode, and must
        // not quietly rewrite sorts that never depended on posted_ts.
        for (const supported of [true, false]) {
            assert.equal(coerceSortToSupported('salary_desc', supported), 'salary_desc');
            assert.equal(coerceSortToSupported('relevance', supported), 'relevance');
        }
    });

    it('produces no Meili sort clause once coerced', () => {
        // End-to-end of the actual defect: the request must stop asking for a
        // sort the backend silently ignores.
        const coerced = coerceSortToSupported('newest', false);
        assert.equal(buildMeiliSort({ q: 'engineer', sort: coerced }), undefined);
        assert.deepEqual(buildMeiliSort({ q: 'engineer', sort: coerceSortToSupported('newest', true) }), [
            'posted_ts:desc',
        ]);
    });
});

describe('sortTriggerLabel (the trigger tells the truth about what ranks the list)', () => {
    it('fit-ranked reads Best fit, whatever the résumé flag or the backend mode', () => {
        for (const mode of JOB_SORT_MODES) for (const r of [true, false, null]) assert.equal(sortTriggerLabel(mode, r, true), 'Best fit');
    });
    it('a résumé user on plain relevance reads Best match: the one click away from Best fit', () => {
        assert.equal(sortTriggerLabel('relevance', true, false), 'Best match');
    });
    it('no résumé, and the other modes, keep the option label', () => {
        for (const mode of JOB_SORT_MODES) {
            for (const resumeOnFile of [false, null]) assert.equal(sortTriggerLabel(mode, resumeOnFile, false), sortOptionLabel(mode, resumeOnFile));
        }
        assert.equal(sortTriggerLabel('newest', true, false), 'Freshest');
    });
});

describe('sortOptionLabel', () => {
    it('returns a non-empty, sentence-case label for every JobSortMode, under both résumé states', () => {
        // Class check, not instance check: iterates JOB_SORT_MODES (the type's
        // own source of truth) rather than hand-listing 'newest'/'salary_desc'/
        // 'relevance' again — a fourth mode added later is covered for free.
        for (const mode of JOB_SORT_MODES) {
            for (const resumeOnFile of [true, false, null]) {
                const label = sortOptionLabel(mode, resumeOnFile);
                assert.ok(label.length > 0, `${mode}/${resumeOnFile} produced an empty label`);
                assert.doesNotMatch(label, /^[a-z]/, `${mode}/${resumeOnFile} label "${label}" is not sentence-case`);
            }
        }
    });

    it('relevance depends on resumeOnFile; every other mode does not', () => {
        assert.equal(sortOptionLabel('relevance', true), 'Best match');
        assert.equal(sortOptionLabel('relevance', false), 'Relevance');
        assert.equal(sortOptionLabel('relevance', null), 'Relevance');
        for (const mode of JOB_SORT_MODES.filter((m) => m !== 'relevance')) {
            const labels = new Set([true, false, null].map((resumeOnFile) => sortOptionLabel(mode, resumeOnFile)));
            assert.equal(labels.size, 1, `${mode} label varies with resumeOnFile: ${[...labels].join(', ')}`);
        }
    });

    it('is the one label source the sort menu (the one sort control at every width) imports — a re-typed literal cannot drift back in', () => {
        // Regression guard for the actual defect: the since-removed mobile
        // sort tabs used to carry their own hand-typed lowercase copies
        // ('freshest', 'top pay') instead of importing this function.
        const pageSrc = readFileSync(path.join(__dirname, '../../src/app/jobs/JobsContent.tsx'), 'utf8');
        assert.match(pageSrc, /import\s*\{[^}]*\bsortOptionLabel\b[^}]*\}\s*from\s*["']@\/lib\/jobs\/sort["']/);
        const sortOptionLabelCallSites = pageSrc.match(/sortOptionLabel\(/g) ?? [];
        assert.ok(sortOptionLabelCallSites.length >= 3, `expected sortOptionLabel used at every sort menu item, found ${sortOptionLabelCallSites.length}`);
        assert.doesNotMatch(pageSrc, /label="freshest"/);
        assert.doesNotMatch(pageSrc, /label="top pay"/);
    });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    resolveEffectiveSort,
    buildMeiliSort,
    compareJobsBySort,
    coerceSortToSupported,
} from '../../src/lib/jobs/sort';
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
    it('returns first_seen_at:desc for newest — ranks by when WE saw the role, not the employer-claimed date', () => {
        assert.deepEqual(buildMeiliSort({ sort: 'newest' }), ['first_seen_at:desc']);
    });

    // BEST MATCH: a case OTHER than "newest" — proves the fix didn't special-case
    // just the mode it was written for; relevance still emits no explicit sort.
    it('returns undefined for relevance with a query (best match)', () => {
        assert.equal(buildMeiliSort({ sort: 'relevance', q: 'engineer' }), undefined);
    });

    // TOP PAY regression guard — untouched by the newest→first_seen_at change.
    it('returns salary sorts for salary_desc (top pay)', () => {
        assert.deepEqual(buildMeiliSort({ sort: 'salary_desc' }), ['salary_max:desc', 'salary_min:desc']);
    });

    it('auto-defaults to first_seen_at:desc without query', () => {
        assert.deepEqual(buildMeiliSort({}), ['first_seen_at:desc']);
    });

    it('normalizes relevance-without-query to newest sort', () => {
        assert.deepEqual(buildMeiliSort({ sort: 'relevance' }), ['first_seen_at:desc']);
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
            'first_seen_at:desc',
        ]);
    });
});

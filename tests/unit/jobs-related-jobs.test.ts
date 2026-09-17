import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dedupeRelatedJobs, resolveRelatedQuery, significantTitleWords } from '../../src/lib/jobs/related-jobs';

interface RowIn {
    id: string;
    title: string;
    company: string | null;
    location: string | null;
    posted_ts?: number | null;
}

describe('resolveRelatedQuery', () => {
    it('enough company hits — uses them as-is, never touches the title', () => {
        assert.deepEqual(
            resolveRelatedQuery({ companyHitCount: 5, title: 'Senior Staff Lead' }),
            { mode: 'company' },
        );
    });

    it('boundary: exactly the minimum company hit count counts as enough', () => {
        assert.deepEqual(
            resolveRelatedQuery({ companyHitCount: 2, title: 'Anything' }),
            { mode: 'company' },
        );
    });

    it('too few company hits with a real title — falls back to its significant keywords', () => {
        assert.deepEqual(
            resolveRelatedQuery({ companyHitCount: 1, title: 'Senior Software Engineer II' }),
            { mode: 'title-fallback', fallbackQuery: 'software engineer' },
        );
    });

    it('zero company hits (e.g. no company_domain on the job) behaves the same as too few', () => {
        assert.deepEqual(
            resolveRelatedQuery({ companyHitCount: 0, title: 'Product Manager' }),
            { mode: 'title-fallback', fallbackQuery: 'product manager' },
        );
    });

    it('too few company hits AND an all-noise-word title — no fallback, never search-everything', () => {
        assert.deepEqual(
            resolveRelatedQuery({ companyHitCount: 0, title: 'Senior Staff Lead' }),
            { mode: 'none' },
        );
    });

    it('too few company hits AND an empty title — no fallback', () => {
        assert.deepEqual(
            resolveRelatedQuery({ companyHitCount: 1, title: '' }),
            { mode: 'none' },
        );
    });
});

describe('significantTitleWords', () => {
    it('strips seniority/qualifier and function words, keeps reading order', () => {
        assert.deepEqual(
            significantTitleWords('Senior Software Engineer II'),
            ['software', 'engineer'],
        );
    });

    it('caps at the requested max, defaulting to 3', () => {
        assert.deepEqual(
            significantTitleWords('Full Stack Platform Infrastructure Engineer'),
            ['full', 'stack', 'platform'],
        );
    });

    it('an all-noise title yields no words at all', () => {
        assert.deepEqual(significantTitleWords('Senior Staff Lead'), []);
    });
});

describe('dedupeRelatedJobs', () => {
    it('excludes the job currently being viewed', () => {
        const rows: RowIn[] = [
            { id: 'current', title: 'Software Engineer', company: 'Acme', location: 'Remote', posted_ts: 100 },
            { id: 'other', title: 'Product Manager', company: 'Acme', location: 'Remote', posted_ts: 100 },
        ];
        const out = dedupeRelatedJobs(rows, 'current');
        assert.deepEqual(out.map((r) => r.id), ['other']);
    });

    it('collapses identical title+company+location rows, keeping the newest posted_ts', () => {
        const rows: RowIn[] = [
            { id: 'a', title: 'Software Engineer', company: 'Acme', location: 'Remote', posted_ts: 100 },
            { id: 'b', title: 'software engineer', company: 'acme', location: 'remote', posted_ts: 300 },
            { id: 'c', title: 'Software Engineer', company: 'Acme', location: 'Remote', posted_ts: 200 },
        ];
        const out = dedupeRelatedJobs(rows, 'current');
        assert.equal(out.length, 1);
        assert.equal(out[0]!.id, 'b');
    });

    it('same title+company but a different location — both kept, not deduped away', () => {
        const rows: RowIn[] = [
            { id: 'nyc', title: 'Software Engineer', company: 'Acme', location: 'New York, NY', posted_ts: 100 },
            { id: 'sf', title: 'Software Engineer', company: 'Acme', location: 'San Francisco, CA', posted_ts: 100 },
        ];
        const out = dedupeRelatedJobs(rows, 'current');
        assert.deepEqual(out.map((r) => r.id).sort(), ['nyc', 'sf']);
    });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    dedupeRelatedJobs,
    MIN_RELATED_HITS,
    pickRelatedJobs,
    relatedCountry,
    relatedJobsHeading,
    relatedTitleQuery,
    significantTitleWords,
} from '../../src/lib/jobs/related-jobs';

interface RowIn {
    id: string;
    title: string;
    company: string | null;
    location: string | null;
    posted_ts?: number | null;
}

describe('relatedTitleQuery', () => {
    it('keeps the significant title words, seniority stripped', () => {
        assert.equal(relatedTitleQuery('Senior Software Engineer II'), 'software engineer');
        assert.equal(relatedTitleQuery('Product Manager'), 'product manager');
    });

    it('an all-noise or empty title has no query — never search-everything', () => {
        assert.equal(relatedTitleQuery('Senior Staff Lead'), null);
        assert.equal(relatedTitleQuery(''), null);
    });
});

describe('relatedCountry', () => {
    it('one country, bare or in a one-item array', () => {
        assert.equal(relatedCountry('Canada'), 'Canada');
        assert.equal(relatedCountry(['Canada']), 'Canada');
        assert.equal(relatedCountry(' US '), 'US');
    });

    it('no country or several — no single place to scope to', () => {
        assert.equal(relatedCountry(null), null);
        assert.equal(relatedCountry(''), null);
        assert.equal(relatedCountry(['Canada', 'US']), null);
    });
});

describe('pickRelatedJobs', () => {
    it('enough similar roles — shows them, even when the company has more', () => {
        // The Makeship report: a Product Manager got the company's Designer,
        // GTM Lead and Developer because the company list came first.
        assert.deepEqual(
            pickRelatedJobs({ titleHits: ['pm-a', 'pm-b'], companyHits: ['designer', 'gtm', 'dev'] }),
            { jobs: ['pm-a', 'pm-b'], basis: 'title' },
        );
    });

    it('too few similar roles — the company\'s own roles, labelled as such', () => {
        assert.deepEqual(
            pickRelatedJobs({ titleHits: ['pm-a'], companyHits: ['designer'] }),
            { jobs: ['designer'], basis: 'company' },
        );
    });

    it('too few similar roles and no company roles — whatever similar roles came back', () => {
        assert.deepEqual(pickRelatedJobs({ titleHits: ['pm-a'], companyHits: [] }), { jobs: ['pm-a'], basis: 'title' });
        assert.deepEqual(pickRelatedJobs({ titleHits: [], companyHits: [] }), { jobs: [], basis: 'title' });
    });

    it('boundary: exactly the minimum counts as enough', () => {
        assert.equal(MIN_RELATED_HITS, 2);
        assert.equal(pickRelatedJobs({ titleHits: ['a', 'b'], companyHits: ['c'] }).basis, 'title');
    });
});

describe('relatedJobsHeading', () => {
    it('similar roles are "More like this"; a company list names the company', () => {
        assert.equal(relatedJobsHeading('title', 'Makeship'), 'More like this');
        assert.equal(relatedJobsHeading('company', 'Makeship'), 'More at Makeship');
        assert.equal(relatedJobsHeading('company', '  '), 'More at this company');
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

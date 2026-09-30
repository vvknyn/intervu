import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadGazetteer } from '../../src/lib/geo/gazetteer';
import {
    dedupeRelatedJobs,
    MIN_RELATED_HITS,
    pickRelatedJobs,
    relatedCountry,
    relatedJobsHeading,
    relatedSeed,
    relatedTitleQuery,
    significantTitleWords,
    titleCore,
} from '../../src/lib/jobs/related-jobs';
import { relatedCountryIso2 } from '../../src/lib/jobs/related-country';

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

describe('titleCore', () => {
    it('keeps the role and drops the team, product or shift after a delimiter', () => {
        assert.equal(titleCore('UX Designer, Chrome Disco'), 'UX Designer');
        assert.equal(titleCore('Registered Nurse - Night Shift'), 'Registered Nurse');
        assert.equal(titleCore('Data Analyst (Contract)'), 'Data Analyst');
        assert.equal(titleCore('Account Executive | EMEA'), 'Account Executive');
    });

    it('keeps an unspaced hyphen, and the whole title when the role would be empty', () => {
        assert.equal(titleCore('Front-End Developer'), 'Front-End Developer');
        assert.equal(titleCore('(Senior) Product Manager'), '(Senior) Product Manager');
    });

    it('feeds the query, so a team name no longer pulls in other roles', () => {
        assert.equal(relatedTitleQuery('UX Designer, Chrome Disco'), 'ux designer');
        assert.equal(relatedTitleQuery('Product Manager, Payments Infrastructure'), 'product manager');
        assert.equal(relatedTitleQuery('Senior, Staff'), null);
    });
});

describe('relatedCountryIso2', () => {
    const gazetteer = loadGazetteer();
    const seed = (over: { country?: string | null; state?: string | null; location?: string | null }) => ({ country: null, state: null, location: null, ...over });

    it('reads the country field as a country, so CA is Canada, not California', () => {
        assert.equal(relatedCountryIso2(seed({ country: 'CA' }), gazetteer), 'CA');
        assert.equal(relatedCountryIso2(seed({ country: 'Canada' }), gazetteer), 'CA');
        assert.equal(relatedCountryIso2(seed({ country: 'US' }), gazetteer), 'US');
        assert.equal(relatedCountryIso2(seed({ country: 'GBR' }), gazetteer), 'GB');
    });

    it('falls back to the state, then to a piece of the location text', () => {
        assert.equal(relatedCountryIso2(seed({ state: 'CALIFORNIA' }), gazetteer), 'US');
        assert.equal(relatedCountryIso2(seed({ location: 'Universal City, CALIFORNIA' }), gazetteer), 'US');
        assert.equal(relatedCountryIso2(seed({ location: 'Toronto, Ontario, Canada' }), gazetteer), 'CA');
    });

    it('searches everywhere when nothing names a country', () => {
        assert.equal(relatedCountryIso2(seed({ location: 'Administration Building' }), gazetteer), null);
        assert.equal(relatedCountryIso2(seed({ location: 'Merseyside Hire And Service Centre' }), gazetteer), null);
        assert.equal(relatedCountryIso2(seed({}), gazetteer), null);
    });

    it('reads a country from location text that is not "City, Country" (2026-09-30)', () => {
        assert.equal(relatedCountryIso2(seed({ location: 'NYC Office' }), gazetteer), 'US');
        assert.equal(relatedCountryIso2(seed({ location: 'Utah County Administration Building' }), gazetteer), 'US');
        // Was Jamaica: a parish there is named Manchester.
        assert.equal(relatedCountryIso2(seed({ location: 'Manchester' }), gazetteer), 'GB');
    });

    it('a place beside its own country code outranks the country field', () => {
        assert.equal(relatedCountryIso2(seed({ country: 'US', location: 'CA, Oakville 1, Office' }), gazetteer), 'CA');
        assert.equal(relatedCountryIso2(seed({ country: 'United States', location: 'CA, Oakville 1, Office' }), gazetteer), 'CA');
        // Agreeing and ambiguous text leave the field alone.
        assert.equal(relatedCountryIso2(seed({ country: 'US', location: 'San Jose, CA' }), gazetteer), 'US');
        assert.equal(relatedCountryIso2(seed({ country: 'US', location: 'Ontario, CA' }), gazetteer), 'US');
        assert.equal(relatedCountryIso2(seed({ country: 'US', location: 'London' }), gazetteer), 'US');
    });
});

describe('relatedSeed', () => {
    it('carries plain strings and one country', () => {
        const out = relatedSeed({
            id: 'j1',
            title: 'Product Manager',
            company: ' NBCUniversal ',
            company_domain: 'nbcuniversal.com',
            location: 'Universal City, CALIFORNIA',
            location_state: null,
            location_country: ['US', 'Canada'],
        });
        assert.deepEqual(out, {
            id: 'j1',
            title: 'Product Manager',
            company: 'NBCUniversal',
            companyDomain: 'nbcuniversal.com',
            location: 'Universal City, CALIFORNIA',
            state: null,
            country: null,
        });
    });
});

describe('dedupeRelatedJobs with the viewed job', () => {
    it('drops a twin posting of the viewed job (same title, company and location, another id)', () => {
        const rows: RowIn[] = [
            { id: 'twin', title: 'Product Manager', company: 'NBCUniversal', location: 'Universal City, CALIFORNIA', posted_ts: 100 },
            { id: 'other-city', title: 'Product Manager', company: 'NBCUniversal', location: 'New York, NY', posted_ts: 100 },
            { id: 'other', title: 'Senior Product Manager', company: 'Globex', location: 'Remote', posted_ts: 100 },
        ];
        const viewed = { id: 'current', title: 'Product Manager', company: 'NBCUniversal', location: 'Universal City, CALIFORNIA' };
        assert.deepEqual(dedupeRelatedJobs(rows, viewed).map((r) => r.id).sort(), ['other', 'other-city']);
    });
});

/**
 * Class rule (Vivek, 2026-10-22): signals derived from the résumé rank roles, only the person's own choices filter.
 * The résumé's experience levels used to become a hard `experience_level` facet (and `exp=` in the fit URL),
 * dropping roles the fit scorer already judges by level.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCandidateSignals } from '../../src/lib/jobs/candidate-signals';
import { packFilters } from '../../src/lib/jobs/for-you/pack-filters';
import { mergeFacets } from '../../src/lib/jobs/resume-match';
import { parseJobsUrl, serializeJobsUrl } from '../../src/lib/jobs/url-state';
import { mkResume } from '../support/jobs-corpus-stub';

const RESUMES = [
    { name: 'senior', resume: mkResume({ yearsOfExperience: 9, location: 'Toronto, Ontario, Canada' }) },
    { name: 'entry', resume: mkResume({ yearsOfExperience: 1, location: 'Austin, TX' }) },
];

describe('résumé-derived levels rank, never filter', () => {
    for (const { name, resume } of RESUMES) {
        it(`${name}: the pack carries no experience_level facet and the fit URL writes no exp=`, () => {
            const signals = resolveCandidateSignals(resume);
            assert.ok(signals.seniority.value, 'the résumé does name a level (scoring still reads it)');
            const filters = packFilters(resume, signals);
            assert.equal(filters.facets.experience_level, undefined);
            assert.ok(filters.facets.location_country?.length, 'location stays a facet');
            assert.equal(filters.postedBucket, '30d');
            const url = new URLSearchParams(serializeJobsUrl(filters));
            assert.equal(url.get('sort'), 'fit');
            assert.equal(url.has('exp'), false);
        });
    }

    it("a level the person picked still filters, whatever the résumé says (applyFit merges it with the pack)", () => {
        for (const picked of [['entry'], ['senior', 'lead']]) {
            const filters = packFilters(RESUMES[0]!.resume, resolveCandidateSignals(RESUMES[0]!.resume));
            const facets = mergeFacets({ experience_level: picked }, filters.facets);
            assert.deepEqual(facets.experience_level, picked);
            const url = parseJobsUrl(new URLSearchParams(serializeJobsUrl({ ...filters, facets })));
            assert.deepEqual(url.facets.experience_level, picked);
        }
    });
});

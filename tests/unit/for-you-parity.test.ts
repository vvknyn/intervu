/**
 * Product contract: a For-you pack IS a /jobs filter state. The ids a
 * candidate's pack returns must equal the ids they get by opening the pack's
 * "Edit filters" link and searching by hand — for every persona, not just
 * one country. Fit may reorder; it never removes.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCandidateSignals } from '../../src/lib/jobs/candidate-signals';
import { packFilters } from '../../src/lib/jobs/for-you/pack-filters';
import { rankForYou } from '../../src/lib/jobs/for-you/ranked';
import { resumeSearchMark, searchParamsFromUrlState } from '../../src/lib/jobs/search-payload';
import { resolveJobsHomeView } from '../../src/lib/jobs/for-you/home-view';
import { jobsBoardHref, parseJobsUrl } from '../../src/lib/jobs/url-state';
import type { AgentPreferences } from '../../src/lib/agent/preferences';
import type { JobSearchParams } from '../../src/lib/jobs/types';
import { corpusStub, mkJob, mkResume } from '../support/jobs-corpus-stub';

const DEPTH = 100;

const CORPUS = [
    mkJob('ca-mid', { location_country: 'Canada' }),
    mkJob('ca-remote', { location_country: 'Canada', work_type: 'remote' }),
    mkJob('us-mid', { location_country: 'United States' }),
    mkJob('us-senior', { location_country: 'United States', experience_level: 'senior' }),
    mkJob('uk-mid', { location_country: 'United Kingdom' }),
    mkJob('in-mid', { location_country: 'India' }),
    mkJob('de-remote', { location_country: 'Germany', work_type: 'remote' }),
    mkJob('multi', { location_country: ['Canada', 'United States'] }),
    // Level never derived (Vivek ruling 20:10: a seniority filter includes these, ranked lower).
    mkJob('us-unknown', { location_country: 'United States', experience_level: 'unknown' }),
    mkJob('ca-unknown', { location_country: 'Canada', experience_level: 'unknown' }),
    mkJob('in-unset', { location_country: 'India', experience_level: undefined as unknown as string }),
    // Poor fit on purpose: fit must push it down, never drop it.
    mkJob('us-nurse', { location_country: 'United States', title: 'Registered Nurse', tags: ['patient care'] }),
];

const remoteGermany: AgentPreferences = {
    configured: true,
    search: { location: 'Berlin, Germany', remoteOnly: true },
    answers: { custom: {} },
};

const PERSONAS = [
    { name: 'Canada', resume: mkResume({ location: 'Toronto, Ontario, Canada' }), prefs: undefined, mustHave: ['ca-mid', 'multi', 'ca-unknown'], mustLack: ['us-mid', 'uk-mid', 'us-unknown'] },
    { name: 'United States', resume: mkResume({ location: 'Austin, TX' }), prefs: undefined, mustHave: ['us-mid', 'multi', 'us-unknown'], mustLack: ['ca-mid', 'in-mid', 'ca-unknown'] },
    { name: 'India', resume: mkResume({ location: 'Bengaluru, India' }), prefs: undefined, mustHave: ['in-mid', 'in-unset'], mustLack: ['ca-mid', 'us-mid'] },
    { name: 'no location', resume: mkResume(), prefs: undefined, mustHave: ['ca-mid', 'us-mid', 'uk-mid', 'in-mid', 'us-unknown'], mustLack: ['us-senior'] },
    { name: 'explicit remote Germany over a Canadian resume', resume: mkResume({ location: 'Toronto, Canada' }), prefs: remoteGermany, mustHave: ['de-remote'], mustLack: ['ca-remote', 'ca-mid'] },
];

const withoutPaging = (params: JobSearchParams): JobSearchParams => ({ ...params, limit: undefined, offset: undefined });

describe('For-you pack == manual /jobs search (same ids, same call)', () => {
    for (const persona of PERSONAS) {
        it(`${persona.name}: pack ids equal the ids of its Edit-filters link, searched by hand`, async () => {
            const signals = resolveCandidateSignals(persona.resume, persona.prefs);
            const filters = packFilters(persona.resume, signals);

            const pack = corpusStub(CORPUS);
            const ranked = await rankForYou({ resume: persona.resume, search: pack.search, candidateDepth: DEPTH, signals });

            // What a person gets: open the link, the board parses the URL, then searches (marked as a résumé's own
            // list, which also leaves out roles past Senior unless the résumé shows one: `resumeSearchMark`).
            const manual = corpusStub(CORPUS);
            const linkState = parseJobsUrl(new URL(jobsBoardHref(filters), 'https://velai.test').searchParams);
            const byHand = await manual.search({
                ...searchParamsFromUrlState(linkState),
                ...resumeSearchMark(true, true, signals.seniority.pastSenior === true),
                limit: DEPTH,
                offset: 0,
            });

            assert.deepEqual(new Set(ranked.hits.map((h) => h.job.id)), new Set(byHand.hits.map((j) => j.id)));
            assert.equal(ranked.hits.length, byHand.hits.length, 'fit never removes a job');
            assert.deepEqual(withoutPaging(pack.calls[0]), withoutPaging(manual.calls[0]), 'one search call, identical params');

            const got = new Set(ranked.hits.map((h) => h.job.id));
            for (const id of persona.mustHave) assert.ok(got.has(id), `${persona.name} pack includes ${id}`);
            for (const id of persona.mustLack) assert.ok(!got.has(id), `${persona.name} pack excludes ${id}`);
        });
    }

    it('the poor-fit job stays in the pack and ranks below the good fit', async () => {
        const resume = mkResume({ location: 'Austin, TX' });
        const { search } = corpusStub(CORPUS);
        const ranked = await rankForYou({ resume, search, candidateDepth: DEPTH });
        const order = ranked.hits.map((h) => h.job.id);
        assert.ok(order.includes('us-nurse'));
        assert.ok(order.indexOf('us-mid') < order.indexOf('us-nurse'));
    });

    it('the Edit-filters link round-trips to exactly the pack filters', () => {
        for (const persona of PERSONAS) {
            const filters = packFilters(persona.resume, resolveCandidateSignals(persona.resume, persona.prefs));
            const parsed = parseJobsUrl(new URL(jobsBoardHref(filters), 'https://velai.test').searchParams);
            assert.deepEqual(searchParamsFromUrlState(parsed), searchParamsFromUrlState(filters), persona.name);
            assert.equal(jobsBoardHref(filters).startsWith('/jobs'), true);
        }
    });

    it('the Edit-filters link lands on the search board, not back on the For-you home', () => {
        for (const persona of PERSONAS) {
            const filters = packFilters(persona.resume, resolveCandidateSignals(persona.resume, persona.prefs));
            const parsed = parseJobsUrl(new URL(jobsBoardHref(filters), 'https://velai.test').searchParams);
            const view = resolveJobsHomeView({
                urlView: parsed.homeView,
                resumeOnFile: true,
                companyDomain: parsed.companyDomain,
                board: parsed.board,
                q: parsed.q,
                sort: parsed.sort,
            });
            assert.equal(view, 'search', persona.name);
        }
    });

    it('rankForYou reports the filters it retrieved with', async () => {
        const resume = mkResume({ location: 'London, UK' });
        const { search } = corpusStub(CORPUS);
        const ranked = await rankForYou({ resume, search, candidateDepth: DEPTH });
        assert.deepEqual(ranked.filters.facets.location_country, ['United Kingdom']);
    });

    it('seniority filter includes unknown-level rows, and ranks every verified-level job above them', async () => {
        const resume = mkResume({ location: 'Austin, TX' });
        const { search } = corpusStub(CORPUS);
        const ranked = await rankForYou({ resume, search, candidateDepth: DEPTH });
        const order = ranked.hits.map((h) => h.job.id);
        assert.ok(order.includes('us-unknown'), 'unknown level is retrieved');
        assert.ok(!order.includes('us-senior'), 'a known, different level is not');
        const firstUnknown = order.indexOf('us-unknown');
        for (const id of ['us-mid', 'multi']) assert.ok(order.indexOf(id) < firstUnknown, `${id} ranks above the unknown-level row`);
        const unknown = ranked.hits.find((h) => h.job.id === 'us-unknown')!;
        assert.ok(unknown.match!.total < 80, 'an unverifiable level never reads as Strong');
        assert.ok(unknown.match!.components.find((c) => c.key === 'seniority')!.unknown, 'and is flagged unknown, not claimed as a level match');
    });

    it('a manual level selection (not just the pack) includes unknown rows: same call, same ids', async () => {
        const { search } = corpusStub(CORPUS);
        const manual = await search({ facets: { experience_level: ['senior'], location_country: ['United States'] } });
        assert.deepEqual(manual.hits.map((j) => j.id).sort(), ['us-senior', 'us-unknown']);
    });
});

/**
 * Product contract: a For-you pack IS a /jobs filter state. The ids a
 * candidate's pack returns must equal the ids they get by opening the pack's
 * "Edit filters" link and searching by hand — for every persona, not just
 * one country. Fit reorders, and leaves out only what the résumé could not take
 * (`deckLeftOut`); it counts what it left out, so no search row goes missing unaccounted.
 */
import { after, before, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCandidateSignals } from '../../src/lib/jobs/candidate-signals';
import { packContentPhrases, packFilters } from '../../src/lib/jobs/for-you/pack-filters';
import { rankForYou } from '../../src/lib/jobs/for-you/ranked';
import { resumeSearchMark, searchParamsFromUrlState } from '../../src/lib/jobs/search-payload';
import { jobsBoardHref, parseJobsUrl } from '../../src/lib/jobs/url-state';
import type { AgentPreferences } from '../../src/lib/agent/preferences';
import type { JobSearchParams } from '../../src/lib/jobs/types';
import { corpusStub, mkJob, mkResume, NOW } from '../support/jobs-corpus-stub';

// The fixtures are dated from the stub's clock; read them against it, not today's, so they do not age past the 30 days a For you list keeps.
before(() => mock.timers.enable({ apis: ['Date'], now: NOW }));
after(() => mock.timers.reset());

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
    // Poor fit on purpose: a recommendation leaves it out, and says so (`leftOut`).
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

            // Every listed role is a row of the search by hand; every other row is counted as left out.
            const byHandIds = new Set(byHand.hits.map((j) => j.id));
            for (const h of ranked.hits) assert.ok(byHandIds.has(h.job.id), `${h.job.id} is a row of the search by hand`);
            assert.equal(ranked.leftOut.considered, byHand.hits.length);
            assert.equal(ranked.leftOut.listed, ranked.hits.length);
            const leftOutCount = Object.values(ranked.leftOut.byReason).reduce((sum, n) => sum + (n ?? 0), 0);
            assert.equal(ranked.hits.length + leftOutCount, byHand.hits.length, 'fit leaves a job out only with a reason');
            // The pack's search adds only the résumé's content phrases (and the no-country remote pool they come with) to the
            // board's own params: they widen the pool, never the filters.
            const { contentPhrases, unplacedRemote, ...packParams } = withoutPaging(pack.calls[0]);
            assert.equal(unplacedRemote === true, (contentPhrases ?? []).length > 0, 'the no-country remote pool rides with the content phrases');
            assert.deepEqual(packParams, withoutPaging(manual.calls[0]), 'one search call, identical params');
            assert.deepEqual(contentPhrases ?? [], packContentPhrases(persona.resume, filters.q), 'the only extra the pack carries is the résumé\'s content phrases');

            const got = new Set(ranked.hits.map((h) => h.job.id));
            for (const id of persona.mustHave) assert.ok(got.has(id), `${persona.name} pack includes ${id}`);
            for (const id of persona.mustLack) assert.ok(!got.has(id), `${persona.name} pack excludes ${id}`);
        });
    }

    it('the poor-fit job is left out of the pack and counted, the good fit is listed', async () => {
        const resume = mkResume({ location: 'Austin, TX' });
        const { search } = corpusStub(CORPUS);
        const ranked = await rankForYou({ resume, search, candidateDepth: DEPTH });
        const order = ranked.hits.map((h) => h.job.id);
        assert.ok(order.includes('us-mid'));
        assert.ok(!order.includes('us-nurse'));
        assert.equal(ranked.leftOut.byReason['other-role'], 1, 'the nurse role is counted as a different kind of role');
    });

    it('the Edit-filters link round-trips to exactly the pack filters', () => {
        for (const persona of PERSONAS) {
            const filters = packFilters(persona.resume, resolveCandidateSignals(persona.resume, persona.prefs));
            const parsed = parseJobsUrl(new URL(jobsBoardHref(filters), 'https://velai.test').searchParams);
            assert.deepEqual(searchParamsFromUrlState(parsed), searchParamsFromUrlState(filters), persona.name);
            assert.equal(jobsBoardHref(filters).startsWith('/jobs'), true);
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

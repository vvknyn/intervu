import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { THIN_RESULTS_BELOW, broadenRungs, countResults, isThinResults, locationDropped, resolveBroadenOptions } from '../../src/lib/jobs/broaden';
import { DEFAULT_URL_STATE, type JobsUrlState } from '../../src/lib/jobs/url-state';
import type { JobSearchParams, JobSearchResult } from '../../src/lib/jobs/types';
import { NOW, corpusStub, mkJob } from '../support/jobs-corpus-stub';

const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

const state = (facets: JobsUrlState['facets'], patch: Partial<JobsUrlState> = {}): JobsUrlState => ({ ...DEFAULT_URL_STATE, facets, ...patch });
const canadaMid = state({ location_country: ['Canada'], experience_level: ['mid'] });

const CORPUS = [
    ...['c1', 'c2', 'c3'].map((id) => mkJob(id, { location_country: 'Canada' })),
    ...['cs1', 'cs2', 'cs3', 'cs4', 'cs5'].map((id) => mkJob(id, { location_country: 'Canada', experience_level: 'senior' })),
    ...['r1', 'r2', 'r3', 'r4'].map((id) => mkJob(id, { location_country: 'United States', work_type: 'remote' })),
    ...['g1', 'g2', 'g3', 'g4', 'g5', 'g6'].map((id) => mkJob(id, { location_country: 'Germany' })),
    ...['o1', 'o2'].map((id) => mkJob(id, { location_country: 'Canada', posted_at: daysAgo(40) })),
];

const ids = (options: { id: string }[]) => options.map((o) => o.id);
const countsById = (options: { id: string; count: number }[]) => Object.fromEntries(options.map((o) => [o.id, o.count]));

describe('THIN constant', () => {
    it('is the single named threshold', () => {
        assert.equal(THIN_RESULTS_BELOW, 30);
        assert.equal(isThinResults(29), true);
        assert.equal(isThinResults(30), false);
        assert.equal(isThinResults(0), true);
    });
});

describe('broadenRungs', () => {
    it('a location-restricted state gets remote-anywhere; each rung changes only its own facet', () => {
        const rungs = broadenRungs(canadaMid);
        const remote = rungs.find((r) => r.id === 'remote_anywhere')!;
        assert.deepEqual(remote.next.facets.work_type, ['remote']);
        assert.deepEqual(remote.next.facets.location_country, ['any']);
        assert.deepEqual(remote.next.facets.experience_level, ['mid']);
        const seniority = rungs.find((r) => r.id === 'any_seniority')!;
        assert.deepEqual(seniority.next.facets.location_country, ['Canada']);
        assert.equal(seniority.next.facets.experience_level, undefined);
    });

    it('a state with no location and no auto location gets no location rung (nothing to remove)', () => {
        assert.deepEqual(ids(broadenRungs(state({ experience_level: ['mid'] }))), ['any_seniority', 'any_date']);
    });

    it('the "any" sentinel is not a restriction', () => {
        assert.deepEqual(ids(broadenRungs(state({ location_country: ['any'] }))), ['any_date']);
    });

    it('relocation rung exists only when the candidate explicitly stated it', () => {
        assert.equal(ids(broadenRungs(canadaMid)).includes('relocation'), false);
        assert.equal(ids(broadenRungs(canadaMid, { relocation: { open: false, countries: [] } })).includes('relocation'), false);
        const open = broadenRungs(canadaMid, { relocation: { open: true, countries: ['Germany'] } }).find((r) => r.id === 'relocation')!;
        assert.deepEqual(open.next.facets.location_country, ['Canada', 'Germany']);
        const anywhere = broadenRungs(canadaMid, { relocation: { open: true, countries: [] } }).find((r) => r.id === 'relocation')!;
        assert.deepEqual(anywhere.next.facets.location_country, ['any']);
    });

    it('an auto-applied location gets a "Remove <place>" rung that suppresses the default', () => {
        const rungs = broadenRungs(state({}), { autoLocationLabel: 'Ontario' });
        const remove = rungs.find((r) => r.id === 'remove_location')!;
        assert.equal(remove.label, 'Remove Ontario');
        assert.deepEqual(remove.next.facets.location_country, ['any']);
    });

    it('a user-chosen location never gets a "Remove" rung labelled as auto', () => {
        assert.equal(ids(broadenRungs(canadaMid)).includes('remove_location'), false);
    });

    it('the date rung steps one window wider, and the widest window widens to any date', () => {
        const narrow = broadenRungs(state({}, { postedBucket: '3d' })).find((r) => r.id === 'any_date')!;
        assert.equal(narrow.next.postedBucket, '7d');
        const widest = broadenRungs(state({}, { postedBucket: '30d' })).find((r) => r.id === 'any_date')!;
        assert.equal(widest.next.postedBucket, undefined);
        assert.equal(widest.label, 'Any date');
    });
});

describe('resolveBroadenOptions: counts come from the same search call', () => {
    it('counts every option through the shared search and shows only those that add results', async () => {
        const { search, calls } = corpusStub(CORPUS);
        const total = (await search({ facets: canadaMid.facets, postedBucket: '30d' } as JobSearchParams)).total;
        assert.equal(total, 3);
        calls.length = 0;
        const options = await resolveBroadenOptions({ state: canadaMid, total, ctx: { relocation: { open: true, countries: ['Germany'] } }, search });
        assert.deepEqual(countsById(options), {
            remote_anywhere: 4,
            relocation: 9,
            any_seniority: 8,
            any_date: 5,
        });
        assert.ok(calls.every((c) => c.limit === 1), 'counting fetches no more than one hit');
    });

    it('an option that adds 0 is hidden', async () => {
        const { search } = corpusStub(CORPUS.filter((j) => j.location_country !== 'Germany' && !j.id.startsWith('o')));
        const options = await resolveBroadenOptions({ state: canadaMid, total: 3, ctx: { relocation: { open: true, countries: ['Germany'] } }, search });
        assert.deepEqual(ids(options), ['remote_anywhere', 'any_seniority']);
    });

    it('a state that is already at its widest yields no options (no fabricated ones)', async () => {
        const { search } = corpusStub(CORPUS);
        const options = await resolveBroadenOptions({ state: state({ location_country: ['any'] }, { postedBucket: undefined }), total: CORPUS.length, search });
        assert.deepEqual(options, []);
    });

    it('the auto-location rung is counted against the total the auto-located search returned', async () => {
        const { search } = corpusStub(CORPUS);
        const options = await resolveBroadenOptions({ state: state({}), total: 3, ctx: { autoLocationLabel: 'Ontario' }, search });
        const remove = options.find((o) => o.id === 'remove_location')!;
        assert.equal(remove.label, 'Remove Ontario');
        assert.equal(remove.count, CORPUS.filter((j) => !j.id.startsWith('o')).length);
    });

    it('an option whose count cannot be fetched is dropped, never guessed', async () => {
        const { search } = corpusStub(CORPUS);
        const flaky = async (params: JobSearchParams): Promise<JobSearchResult> => {
            if (params.facets?.work_type?.includes('remote')) throw new Error('boom');
            if (params.postedBucket === undefined) return { hits: [], total: 0, backend: 'meilisearch', configured: true, unavailable: true };
            return search(params);
        };
        const options = await resolveBroadenOptions({ state: canadaMid, total: 3, search: flaky, sleep: async () => {} });
        assert.deepEqual(ids(options), ['any_seniority']);
    });
});

/**
 * The search drops a place it cannot filter on (no corpus rows) and says so in
 * `unmatchedPlaceMentions`; the rows it returns are then unfiltered by location.
 */
function droppingUnknownPlaces(corpus = CORPUS) {
    const known = new Set(corpus.map((j) => j.location_country).filter(Boolean) as string[]);
    const { search, calls } = corpusStub(corpus);
    return {
        calls,
        async search(params: JobSearchParams) {
            const named = (params.facets?.location_country ?? []).filter((v) => v !== 'any' && v !== 'all');
            const unmatched = named.filter((v) => !known.has(v));
            if (unmatched.length === 0) return search(params);
            const kept = named.filter((v) => known.has(v));
            const facets = { ...params.facets };
            if (kept.length > 0) facets.location_country = kept;
            else delete facets.location_country;
            return { ...(await search({ ...params, facets })), unmatchedPlaceMentions: unmatched };
        },
    };
}

const iceland = state({ location_country: ['Iceland'] });

describe('locationDropped', () => {
    it('is true only when every named place was dropped', () => {
        assert.equal(locationDropped(iceland, { unmatchedPlaceMentions: ['iceland'] }), true);
        assert.equal(locationDropped(iceland, {}), false);
        assert.equal(locationDropped(state({ location_country: ['Iceland', 'Canada'] }), { unmatchedPlaceMentions: ['Iceland'] }), false);
    });

    it('a state that names no place never dropped one', () => {
        assert.equal(locationDropped(state({}), { unmatchedPlaceMentions: ['Iceland'] }), false);
        assert.equal(locationDropped(state({ location_country: ['any'] }), { unmatchedPlaceMentions: ['any'] }), false);
    });
});

describe('a pack location the corpus has no roles for', () => {
    it('counts 0 when the location is required, the unfiltered total otherwise (the board)', async () => {
        const { search } = droppingUnknownPlaces();
        const inDefaultWindow = CORPUS.filter((j) => !j.id.startsWith('o')).length;
        assert.equal(await countResults(iceland, search), inDefaultWindow);
        assert.equal(await countResults(iceland, search, { locationRequired: true }), 0);
    });

    it('a place the corpus has keeps its own count when another is dropped', async () => {
        const { search } = droppingUnknownPlaces();
        const count = await countResults(state({ location_country: ['Iceland', 'Germany'] }), search, { locationRequired: true });
        assert.equal(count, 6);
    });

    it('the broaden options count against 0 and the location-free rungs still show', async () => {
        const { search } = droppingUnknownPlaces();
        const options = await resolveBroadenOptions({
            state: iceland,
            total: 0,
            ctx: { locationRequired: true, relocation: { open: true, countries: ['Germany'] } },
            search,
        });
        assert.deepEqual(countsById(options), { remote_anywhere: 4, relocation: 6 });
    });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { countResults } from '../../src/lib/jobs/broaden';
import { HUB_PACK_CORPUS_COUNT_LOADING } from '../../src/lib/jobs/for-you/hub-counts';
import { HUB_PACK_IDS } from '../../src/lib/jobs/for-you/hub-pack-filters';
import { hubTile, hubTileRows, isHubPackId, resumeTileLabels } from '../../src/lib/jobs/for-you/hub-tiles';
import { resumeSearchMark, searchParamsFromUrlState } from '../../src/lib/jobs/search-payload';
import { DEFAULT_URL_STATE, type JobsUrlState } from '../../src/lib/jobs/url-state';
import { NOW, corpusStub, mkJob } from '../support/jobs-corpus-stub';

const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

const pack: JobsUrlState = {
    ...DEFAULT_URL_STATE,
    q: 'software engineer',
    facets: { location_country: ['Canada'], experience_level: ['mid'] },
    sort: 'fit',
};

const CORPUS = [
    ...['o1', 'o2', 'o3'].map((id) => mkJob(id, { location_country: 'Canada', posted_at: daysAgo(12) })),
    ...['r1', 'r2'].map((id) => mkJob(id, { location_country: 'Canada', work_type: 'remote', posted_at: daysAgo(12) })),
    mkJob('f1', { location_country: 'Canada', posted_at: daysAgo(2) }),
    mkJob('us', { location_country: 'United States', work_type: 'remote', posted_at: daysAgo(2) }),
];

describe('hubTile: a filter tile is the pack with its own filter on top', () => {
    it('"all" is the pack itself', () => {
        assert.deepEqual(hubTile(pack, 'all'), { kind: 'filter', state: pack });
    });

    it('each filter tile changes only its own field', () => {
        const remote = hubTile(pack, 'remote').state;
        assert.deepEqual(remote.facets, { ...pack.facets, work_type: ['remote'] });
        assert.equal(remote.postedBucket, pack.postedBucket);

        const fresh = hubTile(pack, 'fresh').state;
        assert.equal(fresh.postedBucket, '7d');
        assert.equal(fresh.postedExplicit, true);
        assert.deepEqual(fresh.facets, pack.facets);

        assert.equal(hubTile(pack, 'salary').state.salaryMin, 1);
        assert.equal(hubTile({ ...pack, salaryMin: 90_000 }, 'salary').state.salaryMin, 90_000, 'a higher floor already chosen stays');
    });

    it('a tile with no board filter opens the pack and filters its rows', () => {
        for (const id of ['ai', 'good', 'lead', 'apply'] as const) {
            assert.deepEqual(hubTile(pack, id), { kind: 'rows', state: pack });
        }
    });

    it('the tile ids are exactly the hub pack ids', () => {
        for (const id of HUB_PACK_IDS) assert.equal(isHubPackId(id), true);
        assert.equal(isHubPackId('jobs'), false);
    });
});

describe('a filter tile counts the search its list sends', () => {
    it('remote and this-week counts are the totals of their own searches, not of the pack', async () => {
        const { search, calls } = corpusStub(CORPUS);
        const packTotal = await countResults(pack, search);
        const remoteTotal = await countResults(hubTile(pack, 'remote').state, search);
        const freshTotal = await countResults(hubTile(pack, 'fresh').state, search);
        assert.deepEqual([packTotal, remoteTotal, freshTotal], [6, 2, 1]);

        // The count call is the list's own payload, only with limit 1: a fit-sorted list is a résumé's own, so it
        // leaves out roles past Senior unless the résumé shows one (`resumeSearchMark`).
        const remote = hubTile(pack, 'remote').state;
        const listParams = { ...searchParamsFromUrlState(remote), ...(remote.sort === 'fit' ? resumeSearchMark(true, false, false) : {}) };
        const countCall = calls[1];
        assert.deepEqual({ ...countCall, limit: undefined, offset: undefined }, { ...listParams, limit: undefined, offset: undefined });
    });
});

describe('hubTileRows', () => {
    const ai = mkJob('ai', { title: 'Machine Learning Engineer' });
    const plain = mkJob('plain', { title: 'Backend Engineer', tags: ['go'] });

    it('a row tile keeps only the rows it counts', () => {
        assert.deepEqual(hubTileRows([ai, plain], 'ai', NOW).map((j) => j.id), ['ai']);
    });

    it('a filter tile, or no tile, keeps every row (its search already filtered them)', () => {
        assert.equal(hubTileRows([ai, plain], 'remote', NOW).length, 2);
        assert.equal(hubTileRows([ai, plain], undefined, NOW).length, 2);
    });
});

describe('resumeTileLabels', () => {
    const packCounts = {
        all: { kind: 'exact' as const, value: 120 },
        remote: { kind: 'floor' as const, value: 9 },
        ai: { kind: 'floor' as const, value: 14 },
    };

    it('a filter tile reads its own count, never the pack-row floor', () => {
        const labels = resumeTileLabels(packCounts, { remote: { kind: 'exact', value: 31 } }, false);
        assert.equal(labels.remote, '31 roles');
        assert.equal(labels.ai, '14+ roles');
        assert.equal(labels.all, '120 roles');
    });

    it('a filter tile still counting shows loading; one whose read failed shows no count', () => {
        const labels = resumeTileLabels(packCounts, { remote: null }, false);
        assert.equal(labels.remote, '');
        assert.equal(labels.fresh, HUB_PACK_CORPUS_COUNT_LOADING);
    });
});

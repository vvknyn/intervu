import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { countResults } from '../../src/lib/jobs/broaden';
import { HUB_PACK_CORPUS_COUNT_LOADING } from '../../src/lib/jobs/for-you/hub-counts';
import { HUB_PACK_IDS } from '../../src/lib/jobs/for-you/hub-pack-filters';
import { hubChipCounts, hubChipLists, hubTile, hubTileRows, isHubPackId, resumeTileLabels } from '../../src/lib/jobs/for-you/hub-tiles';
import type { ScoredHubHit } from '../../src/lib/jobs/for-you/hub-counts';
import type { MatchScore } from '../../src/lib/match/score';
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
    const counts = {
        all: { kind: 'exact' as const, value: 15 },
        remote: { kind: 'exact' as const, value: 4 },
        ai: { kind: 'floor' as const, value: 14 },
        fresh: null,
    };

    it('reads each chip from its own count', () => {
        const labels = resumeTileLabels(counts, false);
        assert.equal(labels.all, '15 roles');
        assert.equal(labels.remote, '4 roles');
        assert.equal(labels.ai, '14+ roles');
    });

    it('a filter tile whose read failed shows no count; one still counting shows loading', () => {
        const labels = resumeTileLabels(counts, false);
        assert.equal(labels.fresh, '');
        assert.equal(labels.salary, HUB_PACK_CORPUS_COUNT_LOADING);
    });

    it('an exact count of roles at fewer employers says both, in the deck\'s words; a floor and an even count do not', () => {
        const labels = resumeTileLabels(counts, false, { all: 7, remote: 4, ai: 3 });
        assert.equal(labels.all, '15 roles at 7 employers');
        assert.equal(labels.remote, '4 roles', 'as many employers as roles: no clause');
        assert.equal(labels.ai, '14+ roles', 'a floor is still counting, so it names no employers');
        assert.equal(resumeTileLabels({ all: { kind: 'exact', value: 3 } }, false, { all: 1 }).all, '3 roles at 1 employer');
    });

    it('every chip is loading before the pack has answered', () => {
        const labels = resumeTileLabels({}, true);
        for (const id of HUB_PACK_IDS) assert.equal(labels[id], HUB_PACK_CORPUS_COUNT_LOADING, id);
    });
});

describe('hubChipCounts: a chip counts the roles its list opens with', () => {
    const strong: MatchScore = { total: 88, components: [], role: 'own' };
    const hit = (id: string, extra: Parameters<typeof mkJob>[1] = {}): ScoredHubHit => ({
        job: mkJob(id, { title: 'Product Manager', company: `Co ${id}`, posted_at: daysAgo(3), ...extra }),
        score: strong,
    });
    // The pack's search found 226 and read 5: two listed roles are remote, one is this week's, one is Stretch.
    const pack: ScoredHubHit[] = [
        hit('a', { work_type: 'remote', posted_at: daysAgo(2) }),
        hit('b', { work_type: 'remote' }),
        hit('c'),
        hit('d', { posted_at: daysAgo(60) }),
        { job: mkJob('e', { title: 'Product Manager', company: 'Co e', posted_at: daysAgo(3) }), score: { total: 40, components: [], role: 'own' } },
    ];

    it('"All your matches" and a row tile count what the deck lists of the pack, not what the search found', () => {
        const counts = hubChipCounts({ pack, tiles: {}, nowMs: NOW, settled: true });
        assert.deepEqual(counts.all, { kind: 'exact', value: 3 });
        assert.deepEqual(counts.lead, { kind: 'exact', value: 0 });
    });

    it('is a floor while the pack is still being read', () => {
        const counts = hubChipCounts({ pack, tiles: {}, nowMs: NOW, settled: false });
        assert.deepEqual(counts.all, { kind: 'floor', value: 3 });
    });

    it('a filter tile counts the roles its own search lists, never more than that search returned', () => {
        const remoteRows: ScoredHubHit[] = [hit('a', { work_type: 'remote', posted_at: daysAgo(2) }), hit('b', { work_type: 'remote' }), hit('f', { work_type: 'remote' })];
        const counts = hubChipCounts({ pack, tiles: { remote: remoteRows, fresh: null }, nowMs: NOW, settled: true });
        assert.deepEqual(counts.remote, { kind: 'exact', value: 3 });
        assert.equal(counts.fresh, null, 'a read that failed has no count');
        assert.equal('salary' in counts, false, 'a read still in flight has none yet');
    });

    it('counts the employers a chip\'s roles are at, the cards its deck makes of them', () => {
        const at = (id: string, company: string, extra: Parameters<typeof mkJob>[1] = {}): ScoredHubHit => hit(id, { company, ...extra });
        // Five roles fit, three of them at Orchard CRM: three cards.
        const rows: ScoredHubHit[] = [
            at('o1', 'Orchard CRM', { work_type: 'remote', title: 'Product Manager' }),
            at('o2', 'Orchard CRM', { title: 'Senior Product Manager' }),
            at('o3', 'Orchard CRM', { work_type: 'remote', title: 'Product Manager, Platform' }),
            at('n1', 'Northstar Data'),
            at('b1', 'Beacon Cloud'),
        ];
        const { counts, employers } = hubChipLists({ pack: rows, tiles: { remote: rows.filter((r) => r.job.work_type === 'remote') }, nowMs: NOW, settled: true });
        assert.deepEqual(counts.all, { kind: 'exact', value: 5 });
        assert.equal(employers.all, 3);
        assert.deepEqual(counts.remote, { kind: 'exact', value: 2 });
        assert.equal(employers.remote, 1, 'a filter tile counts the employers of its own search\'s roles');
        assert.equal(hubChipCounts({ pack: rows, tiles: {}, nowMs: NOW, settled: true }).all?.value, 5, 'the remembered counts are still roles');
        const labels = resumeTileLabels(counts, false, employers);
        assert.equal(labels.all, '5 roles at 3 employers');
        assert.equal(labels.remote, '2 roles at 1 employer');
    });

    it('leaves out the roles already in the tracker, like the deck', () => {
        const counts = hubChipCounts({ pack, tiles: {}, isTracked: (job) => job.id === 'a', nowMs: NOW, settled: true });
        assert.deepEqual(counts.all, { kind: 'exact', value: 2 });
    });
});

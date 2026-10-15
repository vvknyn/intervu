/**
 * For you packs lead with fresh roles (Vivek, 2026-10-13: "really old jobs in my
 * For you pack"). Live, the TAM résumé's pack opened with own-title roles 44–90
 * days old above this week's Customer Success roles.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { orderForYouJobsByBand, packAgeTier } from '../../src/lib/jobs/for-you/band-order';
import { mkJob } from '../support/jobs-corpus-stub';
import type { MatchScore } from '../../src/lib/match/score';

const NOW = Date.parse('2026-10-13T12:00:00Z');
const DAY = 86_400_000;
// A fit the list recommends: the candidate's own kind of role, Good (`forYouLeftOut` keeps it).
const fits = (): MatchScore => ({
    total: 72,
    role: 'own',
    components: [{ key: 'relevance', label: 'Relevance', detail: 'test', score: 0.72 }],
});
const job = (id: string, ageDays: number | null) =>
    mkJob(id, { id, title: id, posted_ts: ageDays == null ? null : NOW - ageDays * DAY } as never);

describe('packAgeTier', () => {
    it('reads fresh, stale, too old and undated', () => {
        assert.equal(packAgeTier(NOW - 3 * DAY, NOW), 0);
        assert.equal(packAgeTier(NOW - 30 * DAY, NOW), 0);
        assert.equal(packAgeTier(NOW - 45 * DAY, NOW), 1);
        assert.equal(packAgeTier(NOW - 61 * DAY, NOW), 2);
        assert.equal(packAgeTier(null, NOW), 1);
    });
});

describe('pack order by age', () => {
    it('puts a fresh role above an older one with the same score, and leaves out roles over 60 days', () => {
        const jobs = [job('old-85', 85), job('stale-45', 45), job('fresh-5', 5), job('fresh-20', 20)];
        const out = orderForYouJobsByBand(jobs, fits, NOW).map((j) => j.id);
        assert.deepEqual(out, ['fresh-5', 'fresh-20', 'stale-45']);
    });

    it('keeps every row in the order it came when no scores are asked for (anonymous Search)', () => {
        const jobs = [job('old-85', 85), job('fresh-5', 5)];
        assert.deepEqual(orderForYouJobsByBand(jobs, null, NOW).map((j) => j.id), ['old-85', 'fresh-5']);
    });
});

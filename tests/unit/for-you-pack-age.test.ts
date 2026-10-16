/**
 * For you lists roles from the last 30 days (Vivek, 2026-10-13: "really old jobs in my For you pack"; 2026-10-16:
 * "still showing really old jobs from more than 30 days ago"). The pack demoted a role between 30 and 60 days old and
 * listed it last, and a posting an employer re-dated stayed first because only its posted date was read.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    deckLeftOut,
    nearMissSummary,
    olderFitsSummary,
    orderForYouJobsByBand,
    orderNearMisses,
    orderOlderFits,
    packAgeTier,
    PACK_MAX_AGE_DAYS,
    summarizeDeckLeftOut,
} from '../../src/lib/jobs/for-you/band-order';
import { formatDeckShowingLine, formatLeftOutLine, OLDER_FITS_NOTICE } from '../../src/lib/jobs/for-you/left-out-copy';
import { mkJob } from '../support/jobs-corpus-stub';
import type { MatchScore } from '../../src/lib/match/score';

const NOW = Date.parse('2026-10-13T12:00:00Z');
const DAY = 86_400_000;
const iso = (ageDays: number) => new Date(NOW - ageDays * DAY).toISOString();
// A fit the list recommends: the candidate's own kind of role, Good (`forYouLeftOut` keeps it).
const fits = (over: Partial<MatchScore> = {}): MatchScore => ({
    total: 72,
    role: 'own',
    components: [{ key: 'relevance', label: 'Relevance', detail: 'test', score: 0.72 }],
    ...over,
});
const allFit = () => fits();
/** `firstSeenDays`: when we first saw it; omitted = the day it was posted, null = never recorded. */
const job = (id: string, ageDays: number | null, firstSeenDays?: number | null) =>
    mkJob(id, {
        id,
        title: id,
        posted_ts: ageDays == null ? null : NOW - ageDays * DAY,
        posted_at: ageDays == null ? null : iso(ageDays),
        first_seen_at: firstSeenDays === null ? null : firstSeenDays !== undefined ? iso(firstSeenDays) : ageDays == null ? null : iso(ageDays),
    } as never);

describe('packAgeTier', () => {
    it('reads fresh, too old and undated', () => {
        assert.equal(PACK_MAX_AGE_DAYS, 30);
        assert.equal(packAgeTier(NOW - 3 * DAY, NOW), 0);
        assert.equal(packAgeTier(NOW - 30 * DAY, NOW), 0, 'a role exactly 30 days old is still listed');
        assert.equal(packAgeTier(NOW - 31 * DAY, NOW), 2);
        assert.equal(packAgeTier(NOW - 45 * DAY, NOW), 2, 'a month to two months old was listed last; it is left out now');
        assert.equal(packAgeTier(NOW - 61 * DAY, NOW), 2);
        assert.equal(packAgeTier(null, NOW), 1);
    });

    it('goes by the older of the posted date and the date we first saw it', () => {
        assert.equal(packAgeTier(NOW - 2 * DAY, NOW, iso(45)), 2, 'an employer who moved the date forward on an old requisition does not make it new');
        assert.equal(packAgeTier(NOW - 2 * DAY, NOW, iso(31)), 2);
        assert.equal(packAgeTier(NOW - 2 * DAY, NOW, iso(29)), 0);
        assert.equal(packAgeTier(NOW - 40 * DAY, NOW, iso(2)), 2, 'found late: the employer posted it 40 days ago');
        assert.equal(packAgeTier(null, NOW, iso(40)), 2, 'no posted date: the day we first saw it');
        assert.equal(packAgeTier(null, NOW, iso(5)), 0);
        assert.equal(packAgeTier(NOW - 2 * DAY, NOW, 'not a date'), 0, 'a first-seen date that does not parse is not evidence');
        assert.equal(packAgeTier(NOW - 2 * DAY, NOW, '1970-01-01T00:00:00Z'), 0, 'nor is one before 2000');
        assert.equal(packAgeTier(null, NOW, null), 1);
    });
});

describe('pack order by age', () => {
    it('lists only roles from the last 30 days, freshest first, and leaves out every older one', () => {
        const jobs = [job('old-85', 85), job('stale-45', 45), job('stale-31', 31), job('fresh-5', 5), job('fresh-20', 20), job('fresh-30', 30)];
        const out = orderForYouJobsByBand(jobs, allFit, NOW).map((j) => j.id);
        assert.deepEqual(out, ['fresh-5', 'fresh-20', 'fresh-30']);
        for (const id of ['old-85', 'stale-45', 'stale-31']) assert.equal(deckLeftOut(jobs.find((j) => j.id === id)!, fits(), NOW), 'old', id);
    });

    it('leaves out a role the employer re-dated, first seen over 30 days ago', () => {
        const redated = job('redated', 2, 45);
        assert.equal(deckLeftOut(redated, fits(), NOW), 'old');
        assert.deepEqual(orderForYouJobsByBand([redated, job('fresh-5', 5)], allFit, NOW).map((j) => j.id), ['fresh-5']);
    });

    it('keeps every row in the order it came when no scores are asked for (anonymous Search)', () => {
        const jobs = [job('old-85', 85), job('fresh-5', 5)];
        assert.deepEqual(orderForYouJobsByBand(jobs, null, NOW).map((j) => j.id), ['old-85', 'fresh-5']);
    });
});

describe('when no role from the last 30 days fits, the older roles that fit stand in', () => {
    const scores = new Map<string, MatchScore | null>([
        ['older-a', fits({ total: 62 })],
        ['older-b', fits({ total: 85 })],
        ['older-weak', fits({ total: 50 })],
        ['older-senior', fits({ newToManaging: true })],
        ['fresh-weak', fits({ total: 55 })],
    ]);
    const jobs = [job('older-a', 35), job('older-b', 50), job('older-weak', 40), job('older-senior', 45), job('fresh-weak', 4)];
    const getScore = (j: { id: string }) => scores.get(j.id) ?? null;

    it('holds only the older roles that age alone leaves out, best fit first', () => {
        assert.deepEqual(orderForYouJobsByBand(jobs, getScore, NOW).map((j) => j.id), [], 'nothing from the last 30 days fits');
        assert.deepEqual(orderOlderFits(jobs, getScore, NOW).map((j) => j.id), ['older-b', 'older-a']);
        assert.deepEqual(orderOlderFits(jobs, null, NOW), []);
    });

    it('never holds a fresh role, and the closest weaker fits stay fresh ones only', () => {
        assert.deepEqual(orderNearMisses(jobs, getScore, NOW).map((j) => j.id), ['fresh-weak']);
    });

    it('counts them as listed, keeps the rest of the left-out line, and says so', () => {
        const summary = summarizeDeckLeftOut(jobs, getScore, NOW);
        assert.deepEqual(summary.byReason, { old: 4, stretch: 1 });
        const older = olderFitsSummary(summary, 2);
        assert.deepEqual(older, { considered: 5, listed: 2, byReason: { old: 2, stretch: 1 }, older: true });
        assert.equal(formatLeftOutLine(older), 'Left out of the 5 roles found: 2 posted over 30 days ago · 1 a weaker fit');
        assert.equal(formatDeckShowingLine(2, 'older'), '2 roles fit your résumé · all posted over 30 days ago');
        assert.equal(formatDeckShowingLine(1, 'older'), '1 role fits your résumé · all posted over 30 days ago');
        assert.equal(formatDeckShowingLine(2, 'near'), '2 closest roles · each a weaker fit');
        assert.equal(formatDeckShowingLine(2), '2 roles fit your résumé · best fit first');
        assert.match(OLDER_FITS_NOTICE, /No role posted in the last 30 days fits your résumé yet/);
        assert.equal(nearMissSummary(summary).older, undefined);
    });

    it('drops the old count once every old role is listed', () => {
        assert.deepEqual(olderFitsSummary({ considered: 2, listed: 0, byReason: { old: 2 } }, 2), { considered: 2, listed: 2, byReason: {}, older: true });
    });
});

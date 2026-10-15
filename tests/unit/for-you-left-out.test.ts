/**
 * The one rule every recommendation list shares (left-out.ts, band-order.ts): a role is listed only when the
 * résumé could take it, and every role left out is counted with a reason. Vivek, 2026-10-14: "none of the
 * changes you so meticulously worked on even worked... the recommendations are still garbage".
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveCandidateSignals } from '../../src/lib/jobs/candidate-signals';
import { deckLeftOut, orderForYouJobsByBand, summarizeDeckLeftOut } from '../../src/lib/jobs/for-you/band-order';
import { forYouLeftOut } from '../../src/lib/jobs/for-you/left-out';
import { formatDeckShowingLine, formatLeftOutLine, leftOutParts } from '../../src/lib/jobs/for-you/left-out-copy';
import { todayLeftOut } from '../../src/lib/jobs/for-you/today';
import { scoreJobAgainstResume, type MatchScore } from '../../src/lib/match/score';
import { resumeDataFromPlainText } from '../../src/lib/resume/structure-resume-text';
import type { PublicJob } from '../../src/lib/jobs/types';
import { mkJob, NOW } from '../support/jobs-corpus-stub';

const component = (key: string, extra: Record<string, unknown> = {}) => ({ key, label: key, detail: 'test', score: 0.8, ...extra }) as MatchScore['components'][number];
/** A Good fit in the candidate's own kind of role, placed: what the list keeps. */
const fits = (over: Partial<MatchScore> = {}): MatchScore => ({
    total: 72,
    role: 'own',
    components: [component('relevance'), component('seniority', { reason: 'level_fits' }), component('location', { reason: 'in_country' })],
    ...over,
});

describe('forYouLeftOut', () => {
    it('keeps a Good fit in the candidate\'s own or family role', () => {
        assert.equal(forYouLeftOut(fits()), null);
        assert.equal(forYouLeftOut(fits({ role: 'family', total: 90 })), null);
    });

    it('leaves out, by the first reason that applies', () => {
        assert.equal(forYouLeftOut(fits({ outside: { home: ['Canada'], where: 'United States', from: 'resume', total: 80 } })), 'abroad');
        assert.equal(forYouLeftOut(fits({ components: [component('relevance'), component('seniority'), component('location', { unknown: true, reason: 'remote_unplaced' })] })), 'unplaced');
        assert.equal(forYouLeftOut(fits({ newToManaging: true })), 'level');
        assert.equal(forYouLeftOut(fits({ components: [component('relevance'), component('seniority', { reason: 'level_below_ask' }), component('location')] })), 'level');
        assert.equal(forYouLeftOut(fits({ gaps: [{ kind: 'language', text: 'it asks for French and nothing on your résumé shows it' }] })), 'requirement');
        assert.equal(forYouLeftOut(fits({ total: 59 })), 'stretch');
        assert.equal(forYouLeftOut(fits({ role: 'off-target', total: 40 })), 'other-role', 'the kind of role is the more telling reason');
        assert.equal(forYouLeftOut(fits({ role: 'off-target' })), 'other-role');
    });

    it('keeps a title the résumé does not name when the posting fits (content decides, the title only orders)', () => {
        assert.equal(forYouLeftOut(fits({ role: 'adjacent' })), null);
        assert.equal(forYouLeftOut(fits({ role: 'unverified' })), null);
        assert.equal(forYouLeftOut(fits({ role: 'unverified', total: 55 })), 'stretch', 'a title the résumé does not name still has to fit');
    });

    it('keeps a role whose place cannot be checked only when the candidate\'s own place cannot be read and the list is open anyway', () => {
        const unread = fits({ components: [component('relevance'), component('seniority'), component('location', { unknown: true, reason: 'no_resume_place' })] });
        assert.equal(forYouLeftOut(unread), 'unplaced');
        assert.equal(forYouLeftOut(unread, { keepWhenCandidatePlaceUnread: true }), null);
        const roleUnplaced = fits({ components: [component('relevance'), component('seniority'), component('location', { unknown: true, reason: 'remote_unplaced' })] });
        assert.equal(forYouLeftOut(roleUnplaced, { keepWhenCandidatePlaceUnread: true }), 'unplaced');
        assert.equal(forYouLeftOut(roleUnplaced, { keepUnplaced: true }), null, 'the deck keeps a role that names no place, last, with its caveat');
    });

    it('is the rule Today and the daily picks use', () => {
        for (const score of [fits(), fits({ total: 40 }), fits({ role: 'off-target' }), fits({ newToManaging: true })]) {
            assert.equal(todayLeftOut(score), forYouLeftOut(score));
        }
    });
});

const DAY = 86_400_000;
const job = (id: string, ageDays = 3): PublicJob => mkJob(id, { id, title: id, posted_ts: NOW - ageDays * DAY, first_seen_at: new Date(NOW - ageDays * DAY).toISOString() } as never);

describe('deckLeftOut and the deck', () => {
    it('leaves out a posting too old for a pack, and a role with no score, before anything else', () => {
        assert.equal(deckLeftOut(job('old', 90), fits(), NOW), 'old');
        assert.equal(deckLeftOut(job('unscored'), null, NOW), 'other-role');
        assert.equal(deckLeftOut(job('ok'), fits(), NOW), null);
        const bareRemote = fits({ components: [component('relevance'), component('seniority'), component('location', { unknown: true, reason: 'remote_unplaced' })] });
        assert.equal(deckLeftOut(job('remote'), bareRemote, NOW), null, 'a bare Remote is listed (last), not hidden');
    });

    it('lists only what it keeps, and the summary accounts for every other row', () => {
        const scores = new Map<string, MatchScore | null>([
            ['good', fits()],
            ['strong', fits({ total: 90 })],
            ['weak', fits({ total: 40 })],
            ['senior', fits({ newToManaging: true })],
            ['lang', fits({ gaps: [{ kind: 'language', text: 'x' }] })],
            ['other', fits({ role: 'off-target' })],
            ['none', null],
        ]);
        const jobs = [...scores.keys()].map((id) => job(id)).concat(job('old', 90));
        scores.set('old', fits());
        const getScore = (j: PublicJob) => scores.get(j.id) ?? null;
        const listed = orderForYouJobsByBand(jobs, getScore, null, NOW).map((j) => j.id);
        assert.deepEqual(listed, ['strong', 'good']);
        const summary = summarizeDeckLeftOut(jobs, getScore, NOW);
        assert.deepEqual(summary, {
            considered: 8,
            listed: 2,
            byReason: { stretch: 1, level: 1, requirement: 1, 'other-role': 2, old: 1 },
        });
    });

    it('keeps every row when no clock is passed (anonymous Search), and when no scores are asked for', () => {
        const jobs = [job('a'), job('b')];
        assert.equal(orderForYouJobsByBand(jobs, () => fits({ total: 20 })).length, 2);
        assert.equal(orderForYouJobsByBand(jobs, null, null, NOW).length, 2);
    });
});

describe('what the list says about the roles it left out', () => {
    it('names how many and why, the most common reason first', () => {
        const summary = { considered: 150, listed: 68, byReason: { level: 41, 'other-role': 22, requirement: 19 } };
        assert.deepEqual(leftOutParts(summary), ['41 above your level', '22 a different kind of role', "19 asking for something your résumé doesn't show"]);
        assert.equal(formatLeftOutLine(summary), "Left out of the 150 roles found: 41 above your level · 22 a different kind of role · 19 asking for something your résumé doesn't show");
    });
    it('says nothing when it left nothing out', () => {
        assert.equal(formatLeftOutLine({ considered: 20, listed: 20, byReason: {} }), null);
        assert.equal(formatLeftOutLine(null), null);
    });
    it('counts what fits, never the size of the search', () => {
        assert.equal(formatDeckShowingLine(68), '68 roles fit your résumé · best fit first');
        assert.equal(formatDeckShowingLine(1), '1 role fits your résumé · best fit first');
        assert.equal(formatDeckShowingLine(0), null);
    });
});

describe('real scores: the rule on the TAM résumé', () => {
    const TAM = resumeDataFromPlainText(readFileSync('tests/fixtures/vivek-tam-resume.txt', 'utf8'));
    const canada = (title: string, experience_level: string, extra: Partial<PublicJob> = {}) =>
        mkJob(title, { title, experience_level, location_country: 'Canada', work_type: 'remote', tags: [], ...extra });
    const reason = (j: PublicJob) => deckLeftOut(j, scoreJobAgainstResume(TAM, j, resolveCandidateSignals(TAM, null)), NOW);

    it('lists his own role and a customer success role, and leaves out staff, junior and engineering roles', () => {
        assert.equal(reason(canada('Technical Account Manager', 'mid')), null);
        assert.equal(reason(canada('Customer Success Manager', 'mid')), null);
        assert.equal(reason(canada('Staff Technical Account Manager', 'senior')), 'level');
        assert.equal(reason(canada('Junior Technical Account Manager', 'mid')), 'level');
        assert.equal(reason(canada('Software Engineer, SRE', 'senior')), 'other-role');
    });
});

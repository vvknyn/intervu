/**
 * Personalisation fixes from the 2026-10-13 review: the roles a person states
 * drive their packs and their scores, a résumé fills (never overwrites) their
 * preferences, applied roles stay out of packs and carry a badge, newer roles
 * lead among equal fits, and a newer guest résumé is adopted on sign-in.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { mergeAgentPreferences, shapeAgentPreferences, type AgentPreferences } from '../../src/lib/agent/preferences';
import { statedSearch } from '../../src/lib/agent/preference-sources';
import { resumePreferencePatch, resumePreferenceValues } from '../../src/lib/agent/resume-preferences';
import { preferredRoles, resolveCandidateSignals } from '../../src/lib/jobs/candidate-signals';
import { packFilters, packPostedBucket } from '../../src/lib/jobs/for-you/pack-filters';
import { pickToday, type TodayRole } from '../../src/lib/jobs/for-you/today';
import { applyRelevanceQualityReranking } from '../../src/lib/jobs/meilisearch';
import { titleRelevanceScore } from '../../src/lib/jobs/presentation';
import { applyQueryUnderstanding } from '../../src/lib/jobs/query-understanding';
import { buildMatchQuery, splitPreferredRoles, stripWorkMode } from '../../src/lib/jobs/resume-match';
import { freshnessPoints, rankBand, rankTier, roleAffinity, scoreJobAgainstResume, type MatchScore } from '../../src/lib/match/score';
import { compareForYouKeys, forYouSortKey } from '../../src/lib/jobs/for-you/band-order';
import { trackedIndex, trackedPursuitFor } from '../../src/lib/pursuits/applied';
import type { Pursuit } from '../../src/lib/pursuits/types';
import { shouldAdoptGuestResume } from '../../src/lib/resume/adopt-guest-resume';
import { structureResumeText } from '../../src/lib/resume/structure-resume-text';
import type { ResumeData } from '../../src/types/resume';
import { mkJob } from '../support/jobs-corpus-stub';

const golden = (name: string): ResumeData =>
    structureResumeText(readFileSync(path.join(process.cwd(), `tests/fixtures/${name}.txt`), 'utf8').replace(/'/g, '’')) as ResumeData;
const PM = golden('vivek-pm-resume');
const DAY = 86_400_000;
const NOW = Date.parse('2026-10-13T12:00:00Z');

const prefs = (search: AgentPreferences['search'], sources?: AgentPreferences['sources']): AgentPreferences => ({
    configured: true,
    search,
    ...(sources ? { sources } : {}),
    answers: { custom: {} },
});

describe('stated roles drive the pack and the score', () => {
    it('splits a roles answer into titles, never on "and"', () => {
        assert.deepEqual(splitPreferredRoles('Data Analyst, BI Analyst or Analytics Engineer / Sales and Marketing Manager'), [
            'Data Analyst',
            'BI Analyst',
            'Analytics Engineer',
            'Sales and Marketing Manager',
        ]);
    });

    it('work-mode words are not part of a title', () => {
        assert.equal(stripWorkMode('Remote Customer Support Specialist'), 'Customer Support Specialist');
        assert.equal(stripWorkMode('Account Manager (Hybrid)'), 'Account Manager');
        assert.equal(stripWorkMode('Remote'), 'Remote');
    });

    it('the stated role leads the pack query', () => {
        const signals = resolveCandidateSignals(PM, prefs({ query: 'Data Analyst' }));
        assert.deepEqual(preferredRoles(signals), ['Data Analyst']);
        assert.match(packFilters(PM, signals).q, /^"Data Analyst"/);
        assert.match(buildMatchQuery(PM, 2026, ['Data Analyst']).q, /^"Data Analyst"/);
    });

    it('a posting for the stated role is no longer "a different kind of role"', () => {
        const job = mkJob('da', { title: 'Data Analyst', location_country: 'Canada', experience_level: 'mid' });
        assert.equal(roleAffinity(PM, job), 'off-target', 'precondition: the PM résumé alone reads it off-target');
        const signals = resolveCandidateSignals(PM, prefs({ query: 'Data Analyst' }));
        const score = scoreJobAgainstResume(PM, job, signals)!;
        assert.equal(score.role, 'own');
        assert.doesNotMatch(score.components[0].detail, /different kind of role/);
    });

    it('a quoted list of titles is left as titles: a work-mode word inside one is not a filter', async () => {
        const q = '"Remote Support Specialist" OR "Customer Success Manager"';
        assert.deepEqual(await applyQueryUnderstanding({ q }), { q });
        const typed = await applyQueryUnderstanding({ q: 'remote customer success' });
        assert.deepEqual(typed.facets?.work_type, ['remote']);
    });

    it('Settings › Posted within sets the pack window', () => {
        assert.equal(packPostedBucket({}), '30d');
        assert.equal(packPostedBucket({ postedWithinDays: { value: 7, source: 'explicit' } }), '7d');
        const signals = resolveCandidateSignals(PM, prefs({ postedWithinDays: 7 }));
        assert.equal(packFilters(PM, signals).postedBucket, '7d');
    });
});

describe('a résumé fills preferences, never overwrites them', () => {
    it('fills empty fields from the résumé', () => {
        const patch = resumePreferencePatch(prefs({}), PM)!;
        const values = resumePreferenceValues(PM);
        assert.equal(patch.query, values.query);
        assert.equal(patch.experienceLevel, values.experienceLevel);
        assert.ok(patch.query && /product manager/i.test(patch.query), patch.query);
    });

    it('leaves a value the person set', () => {
        const patch = resumePreferencePatch(prefs({ query: 'Data Analyst', location: 'Vancouver' }), PM);
        assert.ok(!patch || (!('query' in patch) && !('location' in patch)), JSON.stringify(patch));
    });

    it('replaces what an earlier résumé filled', () => {
        const patch = resumePreferencePatch(prefs({ query: 'Nurse' }, { query: 'resume' }), PM)!;
        assert.ok(patch.query && /product manager/i.test(patch.query));
    });

    it('merge marks a changed field as the person\'s, an unchanged re-save keeps "resume"', () => {
        const filled = mergeAgentPreferences(prefs({}), { search: { query: 'Product Manager' } }, 'resume');
        assert.equal(filled.sources?.query, 'resume');
        const resaved = mergeAgentPreferences(filled, { search: { query: 'Product Manager', salaryMin: 100000 } });
        assert.equal(resaved.sources?.query, 'resume', 'Settings re-saving the form unchanged is not a statement');
        const edited = mergeAgentPreferences(resaved, { search: { query: 'Data Analyst' } });
        assert.equal(edited.sources?.query, 'user');
    });

    it('a résumé-filled value is shown, but fit reads the résumé for it', () => {
        const stored = shapeAgentPreferences({ search: { query: 'Nurse', location: 'Lisbon' }, search_sources: { query: 'resume', location: 'resume' } });
        assert.deepEqual(statedSearch(stored), {});
        const signals = resolveCandidateSignals(PM, stored);
        assert.equal(signals.roleFamily.source, 'resume');
        assert.equal(signals.location.source, 'resume');
    });
});

describe('applied roles', () => {
    const pursuit = (fields: Partial<Pursuit>): Pursuit =>
        ({ id: 'p1', company_name: 'Stryker', position: 'Product Manager', status: 'applied', job_id: 'old-id', ...fields }) as Pursuit;
    const repost = mkJob('new-id', { title: 'Product Manager', company: 'Stryker', location: 'Hamilton, Canada' });

    it('recognises the same opening listed again under a new id', () => {
        const index = trackedIndex([pursuit({ job_snapshot: { title: 'Product Manager', company: 'Stryker', location: 'Hamilton, Canada', apply_url: '' } })]);
        assert.ok(trackedPursuitFor(repost, index));
        assert.equal(trackedPursuitFor(mkJob('x', { title: 'Product Manager', company: 'Stryker', location: 'Calgary, Canada' }), index), undefined, 'another city is another opening');
    });

    it('a hand-added pursuit with no place matches on company and title', () => {
        assert.ok(trackedPursuitFor(repost, trackedIndex([pursuit({ job_id: null })])));
    });

    it('a saved role is not an applied one', () => {
        assert.equal(trackedPursuitFor(mkJob('old-id'), trackedIndex([pursuit({ status: 'interested' })])), undefined);
    });

    it('Today and the daily picks leave out the re-posted opening', () => {
        const score = { total: 90, components: [], role: 'own' } as unknown as MatchScore;
        const roles: TodayRole[] = [{ job: repost, score }];
        const applied = trackedIndex([pursuit({ job_id: null })]);
        assert.equal(pickToday(roles, { skipped: new Set(), tracked: new Set(), applied }).length, 0);
        assert.equal(pickToday(roles, { skipped: new Set(), tracked: new Set() }).length, 1);
    });
});

describe('newer roles lead among equal fits', () => {
    const score = (total: number, extra: Partial<MatchScore> = {}) =>
        ({ total, role: 'own', familyRank: 0, components: [{ key: 'location', score: 1 }], ...extra }) as unknown as MatchScore;

    /** The order every recommending list uses (`forYouSortKey`): negative when `a` leads. */
    const lead = (a: MatchScore, aPosted: number, b: MatchScore, bPosted: number) =>
        compareForYouKeys(forYouSortKey(a, aPosted, NOW), forYouSortKey(b, bPosted, NOW));

    it('freshness halves every week', () => {
        assert.equal(freshnessPoints(NOW, NOW), 12);
        assert.ok(Math.abs(freshnessPoints(NOW - 7 * DAY, NOW) - 6) < 1e-9);
        assert.equal(freshnessPoints(undefined, NOW), 0);
    });

    it('yesterday\'s 90 ranks above a 25-day-old 98, a 95 still above a same-day 82', () => {
        assert.ok(lead(score(90), NOW - DAY, score(98), NOW - 25 * DAY) < 0);
        assert.ok(lead(score(95), NOW - 3 * DAY, score(82), NOW) < 0);
    });

    it('a Strong role leads a Good one while it is under two weeks old; past that it ranks with the Good ones', () => {
        assert.ok(lead(score(81), NOW - 13 * DAY, score(79), NOW) < 0);
        assert.ok(lead(score(81), NOW - 29 * DAY, score(79), NOW) > 0);
        assert.equal(rankBand(score(81), NOW - 29 * DAY, NOW), rankBand(score(79), NOW, NOW));
        assert.equal(rankBand(score(81)), 0, 'without a posting date, the fit band alone');
    });

    it('a people-manager Stretch sinks below roles they can take; own-title-one-level-up keeps its tier', () => {
        const managing = score(55, { newToManaging: true });
        const aboveLevel = score(55, { components: [{ key: 'seniority', reason: 'level_below_ask', score: 0.25 }] } as Partial<MatchScore>);
        const goodFamily = score(70, { role: 'family' });
        assert.ok(rankTier(managing) > rankTier(goodFamily));
        assert.ok(rankTier(aboveLevel) < rankTier(goodFamily));
    });

    it('the server rerank puts a fresh posting above an old one that lists pay', () => {
        const old = mkJob('old', { title: 'Product Manager', posted_ts: NOW - 28 * DAY, salary_min: 90000, ghost_badge: 'clear' });
        const fresh = mkJob('fresh', { title: 'Product Manager', posted_ts: NOW - 2 * DAY, ghost_badge: 'unscored' });
        assert.deepEqual(applyRelevanceQualityReranking([old, fresh], 'product manager', NOW).map((j) => j.id), ['fresh', 'old']);
    });

    it('a title word that only starts with the query word counts half', () => {
        assert.ok(titleRelevanceScore('Product Manager', 'product manager') > titleRelevanceScore('Production Manager', 'product manager'));
        assert.ok(titleRelevanceScore('Production Manager', 'produc manager') > 0);
    });
});

describe('a résumé parsed as a guest, on sign-in', () => {
    it('is adopted when the account has none, or an older one', () => {
        assert.equal(shouldAdoptGuestResume({ serverHasResume: false, localUpdatedAt: '2026-10-01T00:00:00Z' }), true);
        assert.equal(shouldAdoptGuestResume({ serverHasResume: true, serverUpdatedAt: '2026-09-01T00:00:00Z', localUpdatedAt: '2026-10-01T00:00:00Z' }), true);
    });

    it('never replaces a newer one, or one with no date', () => {
        assert.equal(shouldAdoptGuestResume({ serverHasResume: true, serverUpdatedAt: '2026-10-05T00:00:00Z', localUpdatedAt: '2026-10-01T00:00:00Z' }), false);
        assert.equal(shouldAdoptGuestResume({ serverHasResume: true, serverUpdatedAt: null, localUpdatedAt: '2026-10-01T00:00:00Z' }), false);
    });
});

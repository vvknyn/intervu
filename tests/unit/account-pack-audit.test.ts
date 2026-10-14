/**
 * The 2026-10-14 audit of a signed-in pack: a TAM résumé whose current role is
 * also a product owner (five years), Settings roles "Technical Account Manager,
 * Product Mangager, Customer Success Manager", level mid, remote only.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentPreferences } from '../../src/lib/agent/preferences';
import { resolveCandidateSignals, preferredRoles } from '../../src/lib/jobs/candidate-signals';
import { packFilters } from '../../src/lib/jobs/for-you/pack-filters';
import { pickToday, todaySummary, type TodayRole } from '../../src/lib/jobs/for-you/today';
import { isNonPlaceWord, withoutNonPlaceLocation } from '../../src/lib/jobs/non-place-location';
import { correctRoleTypos, roleSpanYears, splitPreferredRoles, targetRoles } from '../../src/lib/jobs/resume-match';
import { roleAffinity, scoreJobAgainstResume } from '../../src/lib/match/score';
import type { ResumeData } from '../../src/types/resume';
import { mkJob } from '../support/jobs-corpus-stub';

const TAM_PO = {
    profile: { name: 'A Candidate', profession: 'Technical Account Manager (Client-Facing Product Owner)', location: 'Toronto, Ontario', yearsOfExperience: 13 },
    generatedSummary: 'Technical product owner and former engineering lead with 13 years across platform delivery and enterprise SaaS.',
    competencies: [{ category: 'Product Management', items: ['Roadmap', 'Requirements'] }],
    experience: [
        { id: 'e1', company: 'Health Co', role: 'Technical Account Manager (Client-Facing Product Owner)', dates: 'September 2021 — Present', description: 'Owned the platform roadmap.' },
        { id: 'e2', company: 'Data Co', role: 'Technology Lead', dates: 'July 2019 — February 2020', description: '' },
        { id: 'e3', company: 'Transit Co', role: 'Team Lead', dates: 'May 2018 — May 2019', description: '' },
        { id: 'e4', company: 'Ops Co', role: 'Senior Software Engineer', dates: 'February 2013 — April 2018', description: '' },
    ],
    education: [],
    projects: [],
} as unknown as ResumeData;

const prefs = (search: AgentPreferences['search']): AgentPreferences => ({ configured: true, search, answers: { custom: {} } });
const STATED = prefs({ query: 'Technical Account Manager, Product Mangager, Customer Success Manager', experienceLevel: 'mid', remoteOnly: true, location: 'Toronto' });

describe('stated roles: typos and evidence', () => {
    it('a misspelt title word is set right, a real word is left alone', () => {
        assert.equal(correctRoleTypos('Product Mangager'), 'Product Manager');
        assert.equal(correctRoleTypos('Producer'), 'Producer');
        assert.deepEqual(splitPreferredRoles('Technical Account Manager, Product Mangager'), ['Technical Account Manager', 'Product Manager']);
    });

    it('years in a role are read from its dates', () => {
        assert.equal(roleSpanYears('September 2021 — Present', 2026), 5);
        assert.equal(roleSpanYears('no dates', 2026), null);
    });

    it('the product owner years make Product Manager their own role; CSM, never held, is a neighbour', () => {
        const signals = resolveCandidateSignals(TAM_PO, STATED);
        const roles = preferredRoles(signals);
        assert.ok(roles.includes('Product Manager'));
        const t = targetRoles(TAM_PO, roles);
        assert.ok(t.own.includes('Product Owner') && t.own.includes('Product Manager'), JSON.stringify(t.own));
        assert.deepEqual(t.statedUnheld, ['Customer Success Manager']);
        const job = (title: string) => mkJob(title, { title, location_country: 'Canada', work_type: 'remote', experience_level: 'mid' });
        assert.equal(roleAffinity(TAM_PO, job('Product Manager'), roles), 'own');
        assert.equal(roleAffinity(TAM_PO, job('Senior Technical Account Manager'), roles), 'own');
        assert.equal(roleAffinity(TAM_PO, job('Customer Success Manager'), roles), 'adjacent');
    });

    it('a stated mid beside a long led career retrieves and fits Senior', () => {
        const signals = resolveCandidateSignals(TAM_PO, STATED);
        assert.equal(signals.seniority.value, 'senior');
        assert.deepEqual(packFilters(TAM_PO, signals).facets.experience_level, ['mid', 'senior']);
    });
});

describe('a language is not a place', () => {
    it('drops a language city and the place guessed with it', () => {
        assert.ok(isNonPlaceWord('Spanish'));
        assert.ok(isNonPlaceWord('Spanish & English'));
        assert.ok(!isNonPlaceWord('Toronto'));
        const job = mkJob('a', { title: 'Customer Success Manager, Spanish & English', location: 'Spanish', location_city: 'Spanish', location_country: 'Canada' });
        const fixed = withoutNonPlaceLocation(job);
        assert.equal(fixed.location_country, null);
        assert.equal(fixed.location_city, null);
    });
});

describe('Today follows the packs', () => {
    const NOW = Date.parse('2026-10-14T12:00:00Z');
    it('a role first seen over 60 days ago is not a pick, whatever its posted date', () => {
        const signals = resolveCandidateSignals(TAM_PO, STATED);
        const roles = preferredRoles(signals);
        const mk = (id: string, firstSeen: string) =>
            mkJob(id, { title: 'Technical Account Manager', location: 'Remote - Canada', location_country: 'Canada', work_type: 'remote', experience_level: 'mid', posted_ts: NOW - 86_400_000, first_seen_at: firstSeen });
        const picks: TodayRole[] = [mk('old', '2026-05-28T00:00:00Z'), mk('new', '2026-10-12T00:00:00Z')]
            .map((job) => ({ job, score: scoreJobAgainstResume(TAM_PO, job, signals)! }))
            .filter((r) => r.score);
        const out = pickToday(picks, { skipped: new Set(), tracked: new Set(), nowMs: NOW }).map((r) => r.job.id);
        assert.ok(!out.includes('old'), JSON.stringify(out));
        void roles;
    });

    it('a first visit counts the roles it lists, never 0 above two', () => {
        const s = todaySummary({ ready: true, shown: 2, newCount: 0, firstVisit: true, since: 'this week', appliedToday: 0, appliedWaiting: 0 });
        assert.equal(s.picks, '2 roles posted this week fit you.');
    });
});

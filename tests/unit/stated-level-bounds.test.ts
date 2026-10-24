import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { omitsPastSenior, resolveCandidateSignals } from '../../src/lib/jobs/candidate-signals';
import { resumeSearchMark } from '../../src/lib/jobs/search-payload';
import { countResults } from '../../src/lib/jobs/broaden';
import { DEFAULT_URL_STATE } from '../../src/lib/jobs/url-state';
import { packSearchParams } from '../../src/lib/jobs/for-you/pack-filters';
import { withinSenior } from '../../src/lib/jobs/role-level';
import type { AgentPreferences } from '../../src/lib/agent/preferences';
import type { JobSearchParams } from '../../src/lib/jobs/types';
import type { ResumeData } from '../../src/types/resume';

function resume(role: string): ResumeData {
    return {
        profile: { name: '', profession: 'Growth Marketer', yearsOfExperience: 9, location: 'Toronto, Canada', email: '', phone: '', linkedin: '' },
        experience: [{ id: '1', company: 'Acme', role, dates: '2019 - 2023', description: 'Led the growth team' }],
        competencies: [{ category: 'Skills', skills: ['SEO', 'Analytics'] }],
        education: [],
        generatedSummary: '',
    };
}
const stated = (experienceLevel?: string): AgentPreferences => ({ configured: true, search: experienceLevel ? { experienceLevel } : {}, answers: { custom: {} } });
const seniorityOf = (role: string, level?: string) => resolveCandidateSignals(resume(role), stated(level)).seniority;

describe('a level picked in Settings bounds past-Senior roles', () => {
    it('stated mid beside a "Head of Growth" résumé: past Senior is left out', () => {
        const s = seniorityOf('Head of Growth', 'mid');
        assert.equal(s.pastSenior, undefined);
        assert.equal(omitsPastSenior(s, false), true);
        assert.equal(omitsPastSenior(s, true), true);
    });
    it('stated senior beside a "Group Product Manager" résumé: left out', () => {
        assert.equal(omitsPastSenior(seniorityOf('Group Product Manager', 'senior'), false), true);
    });
    it('stated lead or executive: kept', () => {
        for (const level of ['lead', 'executive']) {
            const s = seniorityOf('Marketing Manager', level);
            assert.equal(s.pastSenior, true, level);
            assert.equal(omitsPastSenior(s, true), false, level);
            assert.equal(omitsPastSenior(s, false), false, level);
        }
    });
    it('no stated level + a "Principal Engineer" résumé: kept (the résumé decides)', () => {
        const s = seniorityOf('Principal Engineer');
        assert.equal(s.pastSenior, true);
        assert.equal(omitsPastSenior(s, true), false);
    });
    it('no stated level + no past-Senior title: omitted in a fit list only', () => {
        const s = seniorityOf('Marketing Manager');
        assert.equal(omitsPastSenior(s, true), true);
        assert.equal(omitsPastSenior(s, false), false);
    });
    it('no résumé at all: a fit list omits, a plain one does not', () => {
        assert.equal(omitsPastSenior(null, true), true);
        assert.equal(omitsPastSenior(null, false), false);
    });
});

describe('every caller reads the one decision', () => {
    const mid = seniorityOf('Head of Growth', 'mid');
    const lead = seniorityOf('Head of Growth', 'lead');
    it('resumeSearchMark marks a non-fit board for a stated level, and not for lead', () => {
        assert.deepEqual(resumeSearchMark(false, true, mid), { jdTerms: true, omitPastSenior: true });
        assert.deepEqual(resumeSearchMark(false, true, lead), { jdTerms: true });
        assert.deepEqual(resumeSearchMark(true, false, mid), { fromResume: true, omitPastSenior: true });
    });
    it('the pack search and the broaden counts follow it', async () => {
        const signals = { seniority: mid };
        assert.equal(packSearchParams(DEFAULT_URL_STATE, signals).omitPastSenior, true);
        assert.equal(packSearchParams(DEFAULT_URL_STATE, { seniority: lead }).omitPastSenior, undefined);
        const seen: JobSearchParams[] = [];
        const search = async (p: JobSearchParams) => (seen.push(p), { hits: [], total: 3, backend: 'meilisearch' as const, configured: true });
        await countResults({ ...DEFAULT_URL_STATE, sort: 'newest' }, search, { seniority: mid });
        await countResults({ ...DEFAULT_URL_STATE, sort: 'newest' }, search, { seniority: lead });
        await countResults({ ...DEFAULT_URL_STATE, sort: 'newest' }, search, {});
        assert.deepEqual(seen.map((p) => p.omitPastSenior), [true, undefined, undefined]);
    });
});

describe('a non-fit board leaves out roles past Senior (withinSenior)', () => {
    const jobs = [
        { title: 'Senior Product Manager', experience_level: 'senior' },
        { title: 'Group Product Manager', experience_level: 'senior' },
        { title: 'Head of Growth', experience_level: 'unknown' },
        { title: 'Growth Marketer', experience_level: 'executive' },
        { title: 'Principal Engineer', experience_level: 'senior' },
        { title: 'Marketing Manager', experience_level: 'mid' },
    ];
    it('keeps Senior and below, drops Group PM / Head of / Principal / listed Executive', () => {
        assert.deepEqual(jobs.filter(withinSenior).map((j) => j.title), ['Senior Product Manager', 'Marketing Manager']);
    });
});

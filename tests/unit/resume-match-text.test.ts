import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resumeMatchText } from '../../src/lib/resume/match-text';
import { scoreJobAgainstResume } from '../../src/lib/match/score';
import { buildMatchQuery } from '../../src/lib/jobs/resume-match';
import type { ResumeData } from '../../src/types/resume';
import type { PublicJob } from '../../src/lib/jobs/types';

// Minimal ResumeData factory — mirrors match-score.test.ts's `mkResume`, with
// a `projects` field added since that's exactly what this suite exercises.
type ResumeOverrides = Partial<Omit<ResumeData, 'profile'>> & { profile?: Partial<ResumeData['profile']> };

function mkResume(overrides: ResumeOverrides = {}): ResumeData {
    return {
        experience: [],
        competencies: [],
        education: [],
        generatedSummary: '',
        ...overrides,
        profile: {
            name: '', profession: '', yearsOfExperience: 0, location: '', email: '', phone: '', linkedin: '',
            ...overrides.profile,
        },
    };
}

function mkJob(fields: Partial<PublicJob> = {}): PublicJob {
    return {
        id: 'job-1',
        title: 'Software Engineer',
        company: 'Acme',
        location: null,
        work_type: 'remote',
        description: null,
        employment_type: 'full_time',
        experience_level: 'mid',
        salary_min: null,
        salary_max: null,
        salary_currency: null,
        salary_period: null,
        visa_sponsorship: null,
        tags: [],
        apply_url: 'https://example.com',
        source: 'test',
        posted_at: null,
        first_seen_at: null,
        updated_at: null,
        vacancy_status: 'open',
        ghost_badge: 'unscored',
        ...fields,
    } as PublicJob;
}

describe('resumeMatchText', () => {
    it('concatenates summary, experience bullets, project bullets, and skills', () => {
        const text = resumeMatchText(mkResume({
            generatedSummary: 'Builds reliable systems.',
            experience: [{ id: '1', company: 'Acme', role: 'Engineer', dates: '2020', description: 'Shipped the API.' }],
            projects: [{ id: 'p1', company: '', role: 'Side Project', dates: '2024', description: 'Built a Kubernetes operator.' }],
            competencies: [{ category: 'Skills', skills: ['Terraform'] }],
        }));
        assert.match(text, /Builds reliable systems\./);
        assert.match(text, /Shipped the API\./);
        assert.match(text, /Built a Kubernetes operator\./);
        assert.match(text, /Terraform/);
    });

    it('reads degrees, courses and the sections a résumé names itself', () => {
        const text = resumeMatchText(mkResume({
            education: [{ id: 'e1', degree: 'MSc Epidemiology', institution: 'Tailspin University', coursework: ['Biostatistics'] }],
            additionalSections: [{ heading: 'Certifications', lines: ['AWS Certified Solutions Architect'], after: 'education' }],
        }));
        assert.match(text, /MSc Epidemiology/);
        assert.match(text, /Biostatistics/);
        assert.match(text, /AWS Certified Solutions Architect/);
        assert.doesNotMatch(text, /Tailspin University/);
    });

    it('searches by a résumé whose work is written only under a heading of its own', () => {
        const resume = mkResume({
            additionalSections: [{
                heading: 'Highlights',
                lines: ['Cut API latency by 40% across the payments service', 'Ran the Kubernetes deploy pipeline and incident rota'],
                after: null,
            }],
        });
        assert.equal(buildMatchQuery(resume).q, '"Software Engineer" OR "Software Developer"');
    });

    it('returns empty text for a résumé with nothing in any of the four sources', () => {
        assert.equal(resumeMatchText(mkResume()), '');
    });
});

describe('scoreJobAgainstResume: matchable text beyond experience', () => {
    it('a projects-only résumé (no experience, no skills) scores > 0 against a job naming the project\'s skill', () => {
        const projectsOnly = mkResume({
            projects: [{
                id: 'p1', company: '', role: 'Personal Project', dates: '2024',
                description: 'Built a Kubernetes operator to automate cluster scaling.',
            }],
        });
        const job = mkJob({ title: 'Kubernetes Engineer', tags: ['kubernetes'], occupation: undefined });
        const result = scoreJobAgainstResume(projectsOnly, job);
        assert.ok(result, 'expected a non-null match, not a silent 0');
        assert.ok(result!.total > 0, `expected total > 0, got ${result!.total}`);
    });

    it('a skills-only résumé (no experience, no projects) also scores > 0 — class-wide, not projects-specific', () => {
        const skillsOnly = mkResume({
            competencies: [{ category: 'Skills', skills: ['Kubernetes'] }],
        });
        const job = mkJob({ title: 'Kubernetes Engineer', tags: ['kubernetes'], occupation: undefined });
        const result = scoreJobAgainstResume(skillsOnly, job);
        assert.ok(result, 'expected a non-null match, not a silent 0');
        assert.ok(result!.total > 0, `expected total > 0, got ${result!.total}`);
    });

    it('an experience-only résumé scores identically whether or not an empty projects array is present', () => {
        const base = mkResume({
            profile: { profession: 'Software Engineer', yearsOfExperience: 5 },
            experience: [{ id: '1', company: 'Acme', role: 'Software Engineer', dates: '2020', description: 'Built APIs with Node.js.' }],
        });
        const withEmptyProjects = mkResume({ ...base, projects: [] });
        const job = mkJob({ title: 'Software Engineer', tags: ['node.js'], occupation: 'Software Engineer' });

        const baseTotal = scoreJobAgainstResume(base, job)!.total;
        const withEmptyTotal = scoreJobAgainstResume(withEmptyProjects, job)!.total;
        assert.equal(withEmptyTotal, baseTotal);
    });
});

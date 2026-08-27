import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    scoreJobAgainstResume,
    MATCH_CHIP_BRAND_THRESHOLD,
} from '../../src/lib/match/score';
import type { ResumeData } from '../../src/types/resume';
import type { PublicJob } from '../../src/lib/jobs/types';

// Minimal ResumeData factory — mirrors resume-match.test.ts's `mk` so the two
// suites stay consistent about what a "parse" looks like.
function mkResume(
    profile: Partial<ResumeData['profile']>,
    competencies: ResumeData['competencies'] = [],
): ResumeData {
    return {
        profile: {
            name: '',
            profession: '',
            yearsOfExperience: 0,
            location: '',
            email: '',
            phone: '',
            linkedin: '',
            ...profile,
        },
        experience: [],
        competencies,
        education: [],
        generatedSummary: '',
    };
}

// Minimal PublicJob factory — only the fields score.ts reads.
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

describe('scoreJobAgainstResume', () => {
    it('scores full overlap (skills, occupation, seniority all match) highly', () => {
        const resume = mkResume(
            { profession: 'Backend Engineer', yearsOfExperience: 6 },
            [{ category: 'Languages', skills: ['TypeScript', 'Go', 'SQL'] }],
        );
        const job = mkJob({
            occupation: 'Backend Engineer',
            experience_level: 'senior',
            tags: ['TypeScript', 'Go', 'SQL'],
        });
        const result = scoreJobAgainstResume(resume, job);
        assert.ok(result);
        assert.equal(result!.total, 100);
        assert.equal(result!.components.length, 3);
    });

    it('returns null (not 0) when nothing is comparable', () => {
        const resume = mkResume({ profession: '', yearsOfExperience: NaN }, []);
        const job = mkJob({ occupation: undefined, experience_level: 'unknown', tags: [] });
        assert.equal(scoreJobAgainstResume(resume, job), null);
    });

    it('scores skills-only overlap when occupation/seniority are absent', () => {
        const resume = mkResume(
            { profession: '', yearsOfExperience: NaN },
            [{ category: 'Skills', skills: ['React', 'Python'] }],
        );
        const job = mkJob({ occupation: undefined, experience_level: 'unknown', tags: ['react'] });
        const result = scoreJobAgainstResume(resume, job);
        assert.ok(result);
        assert.equal(result!.components.length, 1);
        assert.equal(result!.components[0].key, 'skills');
        assert.equal(result!.components[0].detail, '1 of your 2');
        // Only the skills component scored (0.5) — total is its own score, not diluted by absent components.
        assert.equal(result!.total, 50);
    });

    it('tolerates case and simple plurals in skill/tag comparison', () => {
        const resume = mkResume({}, [{ category: 'Skills', skills: ['Skill'] }]);
        const job = mkJob({ tags: ['SKILLS'] });
        const result = scoreJobAgainstResume(resume, job);
        assert.ok(result);
        assert.equal(result!.components[0].detail, '1 of your 1');
    });

    it('seniority boundary: exactly 2 years is junior, not mid', () => {
        const resume = mkResume({ yearsOfExperience: 2 });
        const job = mkJob({ experience_level: 'entry' });
        const result = scoreJobAgainstResume(resume, job);
        assert.ok(result);
        const seniority = result!.components.find((c) => c.key === 'seniority');
        assert.equal(seniority?.detail, 'junior — fits');
    });

    it('seniority boundary: exactly 9 years is senior, not lead/principal', () => {
        const resume = mkResume({ yearsOfExperience: 9 });
        const job = mkJob({ experience_level: 'senior' });
        const result = scoreJobAgainstResume(resume, job);
        assert.ok(result);
        const seniority = result!.components.find((c) => c.key === 'seniority');
        assert.equal(seniority?.detail, 'senior — fits');
    });

    it('seniority just above the lead boundary compares against the job vocabulary\'s top rung', () => {
        const resume = mkResume({ yearsOfExperience: 9.5 });
        const job = mkJob({ experience_level: 'senior' });
        const result = scoreJobAgainstResume(resume, job);
        assert.ok(result);
        const seniority = result!.components.find((c) => c.key === 'seniority');
        assert.equal(seniority?.detail, 'lead/principal — fits');
    });

    it('an unmapped experience_level value leaves the seniority component absent', () => {
        const resume = mkResume({ yearsOfExperience: 4 }, [{ category: 'Skills', skills: ['SQL'] }]);
        const job = mkJob({ experience_level: 'director', tags: ['SQL'] });
        const result = scoreJobAgainstResume(resume, job);
        assert.ok(result);
        assert.equal(result!.components.some((c) => c.key === 'seniority'), false);
    });

    it('chip-threshold boundary: 74 is below brand, 75 is at/above it', () => {
        assert.equal(MATCH_CHIP_BRAND_THRESHOLD, 75);
        assert.equal(74 >= MATCH_CHIP_BRAND_THRESHOLD, false);
        assert.equal(75 >= MATCH_CHIP_BRAND_THRESHOLD, true);
    });

    it('the same résumé/job pair scores identically on repeat calls (deterministic, no LLM)', () => {
        const resume = mkResume(
            { profession: 'Product Manager', yearsOfExperience: 4 },
            [{ category: 'Skills', skills: ['SQL', 'Figma'] }],
        );
        const job = mkJob({ occupation: 'Product Manager', experience_level: 'mid', tags: ['sql'] });
        const a = scoreJobAgainstResume(resume, job);
        const b = scoreJobAgainstResume(resume, job);
        assert.deepEqual(a, b);
    });
});

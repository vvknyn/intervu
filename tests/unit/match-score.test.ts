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
    experience: ResumeData['experience'] = [],
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
        experience,
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

// A software-engineering résumé, and four jobs (J1..J4) spanning full
// relevance overlap down to none, all at the SAME "mid" seniority the résumé
// itself sits at — isolates the relevance component's own effect on the
// total from the seniority modifier's.
const SWE_RESUME = mkResume(
    { profession: 'Software Engineer', yearsOfExperience: 5 },
    [{ category: 'Skills', skills: ['JavaScript', 'React', 'Node.js'] }],
);

const J1_FULL_MATCH = mkJob({
    title: 'Software Engineer',
    tags: ['javascript', 'react', 'node.js'],
    occupation: 'Software Engineer',
    experience_level: 'mid',
});
const J2_PARTIAL_MATCH = mkJob({
    title: 'Frontend Developer',
    tags: ['javascript'],
    occupation: 'Frontend Developer',
    experience_level: 'senior',
});
const J3_NO_OVERLAP_SAME_SENIORITY = mkJob({
    title: 'Registered Nurse',
    tags: ['patient care', 'phlebotomy'],
    occupation: 'Registered Nurse',
    experience_level: 'mid',
});
const J4_NO_OVERLAP_WORSE_SENIORITY = mkJob({
    title: 'Registered Nurse',
    tags: ['patient care'],
    occupation: 'Registered Nurse',
    experience_level: 'entry',
});

// A nursing résumé — the corpus is not a tech corpus (nursing matches as
// many live postings as software engineering), so the relevance mechanism
// has to work on this vocabulary exactly as well as it does on J1-J4's,
// with no code path favoring either domain.
const NURSE_RESUME = mkResume(
    { profession: 'Registered Nurse', yearsOfExperience: 5 },
    [{ category: 'Skills', skills: ['Patient Care', 'Phlebotomy'] }],
);

describe('scoreJobAgainstResume', () => {
    describe('root cause: seniority alone can no longer reach a high score', () => {
        it('full topical overlap + matching seniority scores 100', () => {
            const result = scoreJobAgainstResume(SWE_RESUME, J1_FULL_MATCH);
            assert.ok(result);
            assert.equal(result!.total, 100);
            assert.equal(result!.components.length, 2);
            assert.deepEqual(result!.components.map((c) => c.key).sort(), ['relevance', 'seniority']);
        });

        it('zero topical overlap but a matching seniority band scores 25, not 100', () => {
            // This is the bug: the OLD total renormalized over whichever
            // components scored, so "found nothing on the subject, but the
            // level matches" alone reached 100. `relevance` is now required
            // and dominant (0.75 weight) — a job that shares NOTHING with
            // the résumé's actual skills/profession stays low even when
            // `seniority` alone scores a perfect 1.
            const result = scoreJobAgainstResume(SWE_RESUME, J3_NO_OVERLAP_SAME_SENIORITY);
            assert.ok(result);
            const relevance = result!.components.find((c) => c.key === 'relevance');
            const seniority = result!.components.find((c) => c.key === 'seniority');
            assert.equal(relevance?.score, 0);
            assert.equal(seniority?.detail, 'mid — fits');
            assert.equal(result!.total, 25);
        });

        it('zero topical overlap AND a worse seniority band scores lower still (16)', () => {
            const result = scoreJobAgainstResume(SWE_RESUME, J4_NO_OVERLAP_WORSE_SENIORITY);
            assert.ok(result);
            assert.equal(result!.total, 16);
        });
    });

    describe('ordinal: a résumé ranks jobs by how much of THAT job it actually covers', () => {
        it('the SWE résumé ranks J1 > J2 > J3 > J4', () => {
            const t1 = scoreJobAgainstResume(SWE_RESUME, J1_FULL_MATCH)!.total;
            const t2 = scoreJobAgainstResume(SWE_RESUME, J2_PARTIAL_MATCH)!.total;
            const t3 = scoreJobAgainstResume(SWE_RESUME, J3_NO_OVERLAP_SAME_SENIORITY)!.total;
            const t4 = scoreJobAgainstResume(SWE_RESUME, J4_NO_OVERLAP_WORSE_SENIORITY)!.total;
            assert.ok(t1 > t2, `J1 (${t1}) should outrank J2 (${t2})`);
            assert.ok(t2 > t3, `J2 (${t2}) should outrank J3 (${t3})`);
            assert.ok(t3 > t4, `J3 (${t3}) should outrank J4 (${t4})`);
        });

        it('the nursing résumé inverts the ranking — it is the SAME mechanism, not tech-specific', () => {
            const nurseJobScore = scoreJobAgainstResume(NURSE_RESUME, J3_NO_OVERLAP_SAME_SENIORITY)!.total;
            const sweJobScore = scoreJobAgainstResume(NURSE_RESUME, J1_FULL_MATCH)!.total;
            assert.equal(nurseJobScore, 100);
            assert.equal(sweJobScore, 25);
            assert.ok(nurseJobScore > sweJobScore);
        });
    });

    describe('honest gap: an empty résumé never fabricates a score', () => {
        const EMPTY_RESUME = mkResume({ profession: '', yearsOfExperience: NaN }, []);

        it('returns null against a fully-specified job', () => {
            assert.equal(scoreJobAgainstResume(EMPTY_RESUME, J1_FULL_MATCH), null);
        });

        it('returns null regardless of which job — the gap is in the résumé, not one job', () => {
            assert.equal(scoreJobAgainstResume(EMPTY_RESUME, J3_NO_OVERLAP_SAME_SENIORITY), null);
        });
    });

    describe('monotonicity: the fix for scoreSkills dividing by the RÉSUMÉ\'s own count', () => {
        it('padding the résumé with UNRELATED skills never lowers the score', () => {
            const padded = mkResume(
                { profession: 'Software Engineer', yearsOfExperience: 5 },
                [{ category: 'Skills', skills: ['JavaScript', 'React', 'Node.js', 'Photoshop', 'Welding', 'Cooking'] }],
            );
            const base = scoreJobAgainstResume(SWE_RESUME, J2_PARTIAL_MATCH)!.total;
            const withPadding = scoreJobAgainstResume(padded, J2_PARTIAL_MATCH)!.total;
            // The OLD scoreSkills divided by the résumé's own skill count, so
            // this padding would have driven the score DOWN even though none
            // of the added skills relate to the job. The denominator is now
            // the job's own vocabulary, so it can't move at all.
            assert.equal(withPadding, base);
        });

        it('adding a skill that DOES cover more of the job only raises the score', () => {
            const better = mkResume(
                { profession: 'Software Engineer', yearsOfExperience: 5 },
                [{ category: 'Skills', skills: ['JavaScript', 'React', 'Node.js', 'Frontend'] }],
            );
            const base = scoreJobAgainstResume(SWE_RESUME, J2_PARTIAL_MATCH)!.total;
            const withMoreCoverage = scoreJobAgainstResume(better, J2_PARTIAL_MATCH)!.total;
            assert.ok(withMoreCoverage > base, `${withMoreCoverage} should exceed ${base}`);
        });
    });

    describe('responsibility bullets drive relevance when titles do not overlap', () => {
        const PM_JOB = mkJob({
            title: 'Product Manager',
            tags: [],
            occupation: undefined,
            experience_level: 'mid',
        });

        const CS_OPS_BASE = mkResume(
            { profession: 'Customer Success Operations Manager', yearsOfExperience: 8 },
            [],
            [{
                id: '1',
                company: 'Co',
                role: 'Customer Success Operations Manager',
                dates: '2020',
                description: '',
            }],
        );

        const CS_OPS_WITH_DUTIES = mkResume(
            { profession: 'Customer Success Operations Manager', yearsOfExperience: 8 },
            [],
            [{
                id: '1',
                company: 'Co',
                role: 'Customer Success Operations Manager',
                dates: '2020',
                description: [
                    'Owned product roadmap and backlog prioritization.',
                    'Gathered requirements from stakeholders for new features.',
                ].join('\n'),
            }],
        );

        it('scores higher with product-duty bullets than without when job title is Product Manager', () => {
            const without = scoreJobAgainstResume(CS_OPS_BASE, PM_JOB);
            const withDuties = scoreJobAgainstResume(CS_OPS_WITH_DUTIES, PM_JOB);
            assert.ok(without);
            assert.ok(withDuties);
            assert.ok(
                withDuties!.total > without!.total,
                `with duties (${withDuties!.total}) should exceed without (${without!.total})`,
            );
        });
    });

    describe('relevance vocabulary sourcing', () => {
        it('a rank word in the job title (e.g. "Senior") does not change the relevance score', () => {
            const withRank = scoreJobAgainstResume(SWE_RESUME, mkJob({
                title: 'Senior Software Engineer', tags: ['javascript', 'react', 'node.js'],
                occupation: 'Software Engineer', experience_level: 'mid',
            }));
            const withoutRank = scoreJobAgainstResume(SWE_RESUME, J1_FULL_MATCH);
            assert.equal(withRank!.total, withoutRank!.total);
        });

        it('an experience role title alone (no profession, no skills) can still drive a match', () => {
            const roleOnlyResume = mkResume(
                { profession: '', yearsOfExperience: NaN },
                [],
                [{ id: '1', company: 'Acme', role: 'Frontend Developer', dates: '', description: '' }],
            );
            const job = mkJob({ title: 'Frontend Developer', tags: [], occupation: undefined });
            const result = scoreJobAgainstResume(roleOnlyResume, job);
            assert.ok(result);
            assert.equal(result!.total, 100);
            assert.equal(result!.components.length, 1);
            assert.equal(result!.components[0].key, 'relevance');
        });

        it('tolerates case and simple plurals between a résumé skill and a job tag', () => {
            // Title is composed entirely of function words ("the"/"a"/"of")
            // so it contributes nothing to jobVocab — isolates the tag/skill
            // comparison from title noise.
            const resume = mkResume({ yearsOfExperience: NaN }, [{ category: 'Skills', skills: ['Skill'] }]);
            const job = mkJob({ title: 'the a of', tags: ['SKILLS'], occupation: undefined, experience_level: 'unknown' });
            const result = scoreJobAgainstResume(resume, job);
            assert.ok(result);
            assert.equal(result!.components[0].detail, '1 of 1 terms this role names');
            assert.equal(result!.total, 100);
        });
    });

    describe('relevance-only (no comparable seniority data)', () => {
        it('scores and reports against the JOB\'s own vocabulary size, not the résumé\'s', () => {
            const resume = mkResume({ profession: '', yearsOfExperience: NaN }, [
                { category: 'Skills', skills: ['React', 'Python'] },
            ]);
            const job = mkJob({ title: 'React Engineer', tags: ['react'], occupation: undefined, experience_level: 'unknown' });
            const result = scoreJobAgainstResume(resume, job);
            assert.ok(result);
            assert.equal(result!.components.length, 1);
            assert.equal(result!.components[0].key, 'relevance');
            assert.equal(result!.components[0].detail, '1 of 2 terms this role names');
            assert.equal(result!.total, 83);
        });
    });

    describe('seniority (unchanged modifier logic, isolated behind a constant full-relevance pair)', () => {
        const relevantJob = (experience_level: PublicJob['experience_level']) => mkJob({
            title: 'Backend Engineer', tags: ['sql'], occupation: 'Backend Engineer', experience_level,
        });
        const relevantResume = (yearsOfExperience: number) => mkResume(
            { profession: 'Backend Engineer', yearsOfExperience },
            [{ category: 'Skills', skills: ['SQL'] }],
        );

        it('seniority boundary: exactly 2 years is junior, not mid', () => {
            const result = scoreJobAgainstResume(relevantResume(2), relevantJob('entry'));
            const seniority = result!.components.find((c) => c.key === 'seniority');
            assert.equal(seniority?.detail, 'junior — fits');
        });

        it('seniority boundary: exactly 9 years is senior, not lead/principal', () => {
            const result = scoreJobAgainstResume(relevantResume(9), relevantJob('senior'));
            const seniority = result!.components.find((c) => c.key === 'seniority');
            assert.equal(seniority?.detail, 'senior — fits');
        });

        it('seniority just above the lead boundary compares against the job vocabulary\'s top rung', () => {
            const result = scoreJobAgainstResume(relevantResume(9.5), relevantJob('senior'));
            const seniority = result!.components.find((c) => c.key === 'seniority');
            assert.equal(seniority?.detail, 'lead/principal — fits');
        });

        it('an unmapped experience_level value leaves seniority absent, but relevance still scores alone', () => {
            const result = scoreJobAgainstResume(relevantResume(4), relevantJob('director'));
            assert.ok(result);
            assert.equal(result!.components.some((c) => c.key === 'seniority'), false);
            assert.equal(result!.components.length, 1);
        });
    });

    it('chip-threshold boundary: 74 is below brand, 75 is at/above it', () => {
        assert.equal(MATCH_CHIP_BRAND_THRESHOLD, 75);
        assert.equal(74 >= MATCH_CHIP_BRAND_THRESHOLD, false);
        assert.equal(75 >= MATCH_CHIP_BRAND_THRESHOLD, true);
    });

    it('the same résumé/job pair scores identically on repeat calls (deterministic, no LLM)', () => {
        const a = scoreJobAgainstResume(SWE_RESUME, J1_FULL_MATCH);
        const b = scoreJobAgainstResume(SWE_RESUME, J1_FULL_MATCH);
        assert.deepEqual(a, b);
    });

    describe('location component', () => {
        const ONTARIO_RESUME = mkResume(
            { profession: 'Software Engineer', yearsOfExperience: 5, location: 'Richmond Hill, Ontario' },
            [{ category: 'Skills', skills: ['JavaScript', 'React', 'Node.js'] }],
        );

        it('empty résumé location → no location component (existing totals unchanged)', () => {
            const result = scoreJobAgainstResume(SWE_RESUME, J1_FULL_MATCH);
            assert.ok(result);
            assert.equal(result!.total, 100);
            assert.equal(result!.components.some((c) => c.key === 'location'), false);
        });

        it('Ontario résumé + remote job includes location bonus', () => {
            const result = scoreJobAgainstResume(ONTARIO_RESUME, J1_FULL_MATCH);
            assert.ok(result);
            const location = result!.components.find((c) => c.key === 'location');
            assert.ok(location);
            assert.equal(location!.score, 1);
            assert.match(location!.detail, /remote/i);
        });

        it('Ontario résumé + US-only onsite without Canada does not score a full location match', () => {
            const usOnsite = mkJob({
                title: 'Software Engineer',
                tags: ['javascript', 'react', 'node.js'],
                occupation: 'Software Engineer',
                experience_level: 'mid',
                work_type: 'onsite',
                location: 'San Francisco, CA',
                location_country: 'United States',
            });
            const result = scoreJobAgainstResume(ONTARIO_RESUME, usOnsite);
            assert.ok(result);
            const location = result!.components.find((c) => c.key === 'location');
            assert.ok(location);
            assert.equal(location!.score, 0.35);
            assert.match(location!.detail, /different country/i);
        });
    });
});

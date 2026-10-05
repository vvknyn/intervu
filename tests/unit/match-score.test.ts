import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
    scoreJobAgainstResume,
    MATCH_BAND_GOOD_MIN,
    MATCH_BAND_STRONG_MIN,
    MATCH_CHIP_BRAND_THRESHOLD,
    matchBand,
    matchBandLabel,
    matchLabel,
    compareFit,
    outsideLabel,
} from '../../src/lib/match/score';
import { explainMatch } from '../../src/lib/match/explain';
import { resolveCandidateSignals } from '../../src/lib/jobs/candidate-signals';
import { JOB_LIST_ATTRIBUTES_TO_RETRIEVE } from '../../src/lib/jobs/meilisearch';
import { resumeDataFromPlainText } from '../../src/lib/resume/structure-resume-text';
import { stripHtmlLikeIngest } from '../fixtures/job-descriptions/ingest-strip';
import { EXPEL_TAM_HTML } from '../fixtures/job-descriptions/postings';
import type { ResumeData } from '../../src/types/resume';
import type { PublicJob } from '../../src/lib/jobs/types';
import type { AgentPreferences } from '../../src/lib/agent/preferences';

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
// Remote and open anywhere by default, so a test about fit or level has a place every candidate can take.
function mkJob(fields: Partial<PublicJob> = {}): PublicJob {
    return {
        id: 'job-1',
        title: 'Software Engineer',
        company: 'Acme',
        location: 'Remote - Anywhere',
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
            assert.equal(result!.components.length, 3);
            assert.deepEqual(result!.components.map((c) => c.key).sort(), ['location', 'relevance', 'seniority']);
        });

        it('zero topical overlap but a matching seniority band scores 32, not 100', () => {
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
            assert.equal(seniority?.detail, 'mid-level — fits');
            assert.equal(result!.total, 32);
        });

        it('zero topical overlap AND a worse seniority band scores lower still (24)', () => {
            const result = scoreJobAgainstResume(SWE_RESUME, J4_NO_OVERLAP_WORSE_SENIORITY);
            assert.ok(result);
            assert.equal(result!.total, 24);
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
            assert.equal(sweJobScore, 32);
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

        it('scores higher relevance with product-duty bullets than without when job title is Product Manager', () => {
            const without = scoreJobAgainstResume(CS_OPS_BASE, PM_JOB);
            const withDuties = scoreJobAgainstResume(CS_OPS_WITH_DUTIES, PM_JOB);
            assert.ok(without);
            assert.ok(withDuties);
            // Relevance, not the total: a Product Manager posting is a different kind of role
            // from a Customer Success Operations headline, so neither total reaches Strong.
            const relevance = (s: typeof without) => s!.components.find((c) => c.key === 'relevance')!.score;
            assert.ok(
                relevance(withDuties) > relevance(without),
                `with duties (${relevance(withDuties)}) should exceed without (${relevance(without)})`,
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
            // Unknown seniority counts as neutral (flagged), not dropped from the average.
            assert.equal(result!.total, 89);
            assert.deepEqual(result!.components.map((c) => c.key), ['relevance', 'seniority', 'location']);
            assert.equal(result!.components[1].unknown, true);
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
            // The relevance component, not the total: a title naming no role (this one is
            // all function words) can't be tied to the résumé's target, so the total is
            // held under Strong (roleFit "unverified", score.ts).
            assert.equal(result!.components[0].score, 1);
        });
    });

    describe('unknown seniority (neutral, flagged — never dropped from the average)', () => {
        it('scores and reports against the JOB\'s own vocabulary size, not the résumé\'s', () => {
            const resume = mkResume({ profession: '', yearsOfExperience: NaN }, [
                { category: 'Skills', skills: ['React', 'Python'] },
            ]);
            const job = mkJob({ title: 'React Engineer', tags: ['react'], occupation: undefined, experience_level: 'unknown' });
            const result = scoreJobAgainstResume(resume, job);
            assert.ok(result);
            assert.equal(result!.components[0].key, 'relevance');
            assert.equal(result!.components[0].detail, '1 of 2 terms this role names');
            assert.equal(result!.total, 77);
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
            assert.equal(seniority?.detail, 'entry-level — fits');
        });

        it('seniority boundary: exactly 9 years is senior, not lead/principal', () => {
            const result = scoreJobAgainstResume(relevantResume(9), relevantJob('senior'));
            const seniority = result!.components.find((c) => c.key === 'seniority');
            assert.equal(seniority?.detail, 'senior — fits');
        });

        it('an unmapped experience_level value makes seniority neutral and flagged, still counted', () => {
            const result = scoreJobAgainstResume(relevantResume(4), relevantJob('director'));
            assert.ok(result);
            const seniority = result!.components.find((c) => c.key === 'seniority');
            assert.equal(seniority?.unknown, true);
            assert.equal(seniority?.score, 0.5);
            assert.equal(result!.components.length, 3);
        });
    });

    it('chip-threshold boundary: 79 is below brand, 80 is at/above it', () => {
        assert.equal(MATCH_CHIP_BRAND_THRESHOLD, MATCH_BAND_STRONG_MIN);
        assert.equal(MATCH_BAND_STRONG_MIN, 80);
        assert.equal(79 >= MATCH_CHIP_BRAND_THRESHOLD, false);
        assert.equal(80 >= MATCH_CHIP_BRAND_THRESHOLD, true);
    });

    describe('matchBand qualitative labels', () => {
        it('maps boundary scores on the 0–100 integer scale', () => {
            assert.equal(matchBand(0), 'stretch');
            assert.equal(matchBand(59), 'stretch');
            assert.equal(matchBand(60), 'good');
            assert.equal(matchBand(79), 'good');
            assert.equal(matchBand(80), 'strong');
            assert.equal(matchBand(100), 'strong');
        });

        it('matchBandLabel capitalizes each band', () => {
            assert.equal(matchBandLabel('stretch'), 'Stretch');
            assert.equal(matchBandLabel('good'), 'Good');
            assert.equal(matchBandLabel('strong'), 'Strong');
        });

        it('non-finite scores fall back to stretch', () => {
            assert.equal(matchBand(Number.NaN), 'stretch');
            assert.equal(matchBand(Number.POSITIVE_INFINITY), 'stretch');
        });

        it('Good band starts at MATCH_BAND_GOOD_MIN', () => {
            assert.equal(MATCH_BAND_GOOD_MIN, 60);
            assert.equal(matchBand(MATCH_BAND_GOOD_MIN - 1), 'stretch');
            assert.equal(matchBand(MATCH_BAND_GOOD_MIN), 'good');
        });
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

        const usOnsiteJob = (country: string | null) => mkJob({
            title: 'Software Engineer', tags: ['javascript', 'react', 'node.js'], occupation: 'Software Engineer',
            experience_level: 'mid', work_type: 'onsite', location: 'Somewhere', location_country: country,
        });

        it('a remote role open to anyone scores location 1 even when the résumé has no location', () => {
            const result = scoreJobAgainstResume(SWE_RESUME, J1_FULL_MATCH);
            assert.ok(result);
            assert.equal(result!.total, 100);
            assert.equal(result!.components.find((c) => c.key === 'location')?.score, 1);
        });

        it('no résumé location + a country-bound role → neutral, flagged unknown, and never Strong', () => {
            const result = scoreJobAgainstResume(SWE_RESUME, usOnsiteJob('United States'));
            assert.ok(result);
            const location = result!.components.find((c) => c.key === 'location');
            assert.equal(location?.unknown, true);
            assert.equal(location?.score, 0.5);
            assert.ok(result!.total <= MATCH_BAND_STRONG_MIN - 1, `${result!.total} must sit under Strong`);
        });

        it('a role whose country cannot be verified never reads as Strong, whoever the candidate is', () => {
            const result = scoreJobAgainstResume(ONTARIO_RESUME, usOnsiteJob(null));
            assert.ok(result);
            assert.equal(result!.components.find((c) => c.key === 'location')?.unknown, true);
            assert.ok(result!.total <= MATCH_BAND_STRONG_MIN - 1);
        });

        it('same-country scoring is class-wide: an India résumé + India role is a full match, an Ontario role is not', () => {
            const india = mkResume(
                { profession: 'Software Engineer', yearsOfExperience: 5, location: 'Bengaluru, India' },
                [{ category: 'Skills', skills: ['JavaScript', 'React', 'Node.js'] }],
            );
            const inRole = scoreJobAgainstResume(india, usOnsiteJob('India'))!;
            const caRole = scoreJobAgainstResume(india, usOnsiteJob('Canada'))!;
            assert.equal(inRole.components.find((c) => c.key === 'location')?.score, 1);
            assert.equal(caRole.components.find((c) => c.key === 'location')?.score, 0.35);
            assert.equal(inRole.total, 100);
            assert.ok(caRole.total < inRole.total);
        });

        it('a country the candidate said they would relocate to scores 0.8, only when stated', () => {
            const job = usOnsiteJob('United States');
            const stated = resolveCandidateSignals(ONTARIO_RESUME, {
                configured: true,
                search: { location: '', remoteOnly: false },
                answers: { relocation: 'Open to relocating to the US' },
            } as never);
            assert.equal(scoreJobAgainstResume(ONTARIO_RESUME, job, stated)!.components.find((c) => c.key === 'location')?.score, 0.8);
            assert.equal(scoreJobAgainstResume(ONTARIO_RESUME, job)!.components.find((c) => c.key === 'location')?.score, 0.35);
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

        it('Ontario résumé + remote job specified in Canada scores full location match', () => {
            const caRemote = mkJob({
                title: 'Software Engineer',
                tags: ['javascript', 'react', 'node.js'],
                occupation: 'Software Engineer',
                experience_level: 'mid',
                work_type: 'remote',
                location_country: 'Canada',
            });
            const result = scoreJobAgainstResume(ONTARIO_RESUME, caRemote);
            assert.ok(result);
            const location = result!.components.find((c) => c.key === 'location');
            assert.ok(location);
            assert.equal(location!.score, 1);
            assert.equal(location!.detail, 'remote — same country');
        });

        it('Ontario résumé + remote job specified in UK gets partial credit on country mismatch', () => {
            const ukRemote = mkJob({
                title: 'Software Engineer',
                tags: ['javascript', 'react', 'node.js'],
                occupation: 'Software Engineer',
                experience_level: 'mid',
                work_type: 'remote',
                location_country: 'United Kingdom',
            });
            const result = scoreJobAgainstResume(ONTARIO_RESUME, ukRemote);
            assert.ok(result);
            const location = result!.components.find((c) => c.key === 'location');
            assert.ok(location);
            assert.equal(location!.score, 0.65);
            assert.equal(location!.detail, 'remote — based in United Kingdom');
        });

        it('Ontario résumé + a remote job that says it hires anywhere scores a full location match', () => {
            for (const location of ['Remote - Anywhere', 'Worldwide', 'Remote (Global)']) {
                const result = scoreJobAgainstResume(ONTARIO_RESUME, mkJob({ ...J1_FULL_MATCH, location, location_country: null }))!;
                const component = result.components.find((c) => c.key === 'location')!;
                assert.equal(component.score, 1, location);
                assert.equal(component.detail, 'remote — open to people anywhere', location);
            }
            const described = mkJob({ ...J1_FULL_MATCH, location: 'Remote', place_restriction: { label: 'anywhere', countries: [] } });
            assert.equal(scoreJobAgainstResume(ONTARIO_RESUME, described)!.components.find((c) => c.key === 'location')!.reason, 'remote_anywhere');
        });

        it('a remote job that names no country anywhere is unknown, not open: never Strong, whoever the candidate is', () => {
            // "Remote" alone used to read as open to anyone, so US-only roles were Good picks in Canada (2026-10-05).
            for (const resume of [ONTARIO_RESUME, SWE_RESUME]) {
                const result = scoreJobAgainstResume(resume, mkJob({ ...J1_FULL_MATCH, location: 'Remote', location_country: null }))!;
                const component = result.components.find((c) => c.key === 'location')!;
                assert.equal(component.unknown, true);
                assert.ok(result.total <= MATCH_BAND_STRONG_MIN - 1, `${result.total} must sit under Strong`);
                assert.equal(result.outside, undefined);
            }
            const unplaced = scoreJobAgainstResume(ONTARIO_RESUME, mkJob({ ...J1_FULL_MATCH, location: 'Remote', location_country: null }))!;
            assert.equal(unplaced.components.find((c) => c.key === 'location')!.reason, 'remote_unplaced');
        });

        it('a remote job that names no country but pays in the candidate\'s own money counts as theirs, for any country', () => {
            const cases: Array<[string, string]> = [['Toronto, ON', 'CAD'], ['Austin, TX', 'USD'], ['Bengaluru, India', 'INR'], ['Berlin, Germany', 'EUR'], ['London, United Kingdom', 'GBP']];
            for (const [place, currency] of cases) {
                const resume = mkResume({ ...ONTARIO_RESUME.profile, location: place }, ONTARIO_RESUME.competencies);
                const job = mkJob({ ...J1_FULL_MATCH, location: 'Remote', salary_min: 100_000, salary_max: 120_000, salary_currency: currency });
                const component = scoreJobAgainstResume(resume, job)!.components.find((c) => c.key === 'location')!;
                assert.equal(component.reason, 'remote_pay_home', `${place} ${currency}`);
                assert.equal(component.score, 1);
            }
        });
    });
});

/**
 * Today, the For you rows, the company page and the search list score list rows; the job page
 * scores the full posting. Whatever a list row lacks (description, occupation) must not move the
 * score, or one role reads Strong in a list and Stretch on its own page (Vivek, 2026-10-02:
 * Expel's "Technical Account Manager").
 */
describe('a role scores the same on its page as in a list', () => {
    const fixture = (name: string) =>
        resumeDataFromPlainText(readFileSync(path.join(process.cwd(), `tests/fixtures/${name}.txt`), 'utf8'));
    const asListRow = (job: PublicJob): PublicJob =>
        Object.fromEntries(
            JOB_LIST_ATTRIBUTES_TO_RETRIEVE.filter((key) => key in job).map((key) => [key, job[key as keyof PublicJob]]),
        ) as unknown as PublicJob;
    const pages: PublicJob[] = [
        mkJob({
            title: 'Technical Account Manager',
            company: 'Expel',
            location: 'Remote',
            experience_level: 'senior',
            salary_min: 114000,
            salary_max: 166000,
            salary_currency: 'USD',
            occupation: 'Technical Account Managers',
            description: stripHtmlLikeIngest(EXPEL_TAM_HTML),
        }),
        mkJob({
            title: 'Registered Nurse, Emergency',
            company: 'Sunnybrook',
            location: 'Toronto, ON',
            location_country: 'Canada',
            work_type: 'onsite',
            experience_level: 'mid',
            tags: ['nursing', 'emergency'],
            occupation: 'Registered Nurses',
            description: 'Join our emergency department team. You will assess patients, administer medications and coordinate care with physicians in a fast-paced trauma centre.',
        }),
        mkJob({
            title: 'Senior Software Engineer',
            company: 'Acme',
            experience_level: 'senior',
            tags: ['typescript', 'react'],
            must_have_skills: ['TypeScript'],
            occupation: 'Software Developers',
            description: 'We build developer tools used by thousands of teams. You will design APIs, mentor engineers and own services end to end in Node.js and Postgres.',
        }),
    ];
    for (const name of ['vivek-tam-resume', 'health-rn-resume', 'sample-resume']) {
        it(`${name}: each posting's page score equals its list-row score`, () => {
            const resume = fixture(name);
            const signals = resolveCandidateSignals(resume);
            for (const page of pages) {
                assert.deepEqual(
                    scoreJobAgainstResume(resume, page, signals),
                    scoreJobAgainstResume(resume, asListRow(page), signals),
                    page.title,
                );
            }
        });
    }
    it("a Technical Account Manager's résumé reads Expel's TAM role as Strong on its page in the US, and as likely for people in the US in Canada", () => {
        // Remote, no country in its title, place or description, paid in USD (Vivek, 2026-10-03, in Canada: "this is a US job").
        const resume = fixture('vivek-tam-resume');
        const inCanada = scoreJobAgainstResume(resume, pages[0], resolveCandidateSignals(resume))!;
        assert.equal(matchLabel(inCanada), 'Outside Canada');
        assert.equal(matchBand(inCanada.total), 'stretch');
        assert.equal(matchBand(inCanada.outside!.total), 'good');
        assert.equal(inCanada.components.find((c) => c.key === 'location')!.reason, 'remote_pay_abroad');
        assert.equal(
            explainMatch(inCanada).split('. ')[0],
            "It's remote with no country listed, but it pays in USD, so it's likely for people in the United States, outside Canada, where your résumé places you",
        );
        const inUs = { ...resume, profile: { ...resume.profile, location: 'Austin, Texas, United States' } };
        assert.equal(matchBand(scoreJobAgainstResume(inUs, pages[0], resolveCandidateSignals(inUs))!.total), 'strong');
    });
});

/**
 * A role outside every country the candidate can work in reads the same way on every surface, for
 * any country: its label names where they are ("Outside Canada"), never a fit word, and it ranks
 * after the roles they can take. A fit word on such a role read as a fit: Island's "Technical
 * Account Manager - U.S. Federal" said Good to a résumé in Toronto (Vivek, 2026-10-03).
 */
describe('a role outside where the candidate can work', () => {
    const fixture = (name: string) =>
        resumeDataFromPlainText(readFileSync(path.join(process.cwd(), `tests/fixtures/${name}.txt`), 'utf8'));
    const livingIn = (resume: ResumeData, location: string): ResumeData => ({ ...resume, profile: { ...resume.profile, location } });
    const prefs = (search: AgentPreferences['search'], answers: Partial<AgentPreferences['answers']> = {}): AgentPreferences => ({
        configured: true,
        search,
        answers: { custom: {}, ...answers },
    });
    const FIT_WORDS = ['Strong', 'Good', 'Stretch'];
    const homes: Array<{ place: string; country: string; label: string }> = [
        { place: 'Toronto, Ontario, Canada', country: 'Canada', label: 'Outside Canada' },
        { place: 'Austin, Texas, United States', country: 'United States', label: 'Outside US' },
        { place: 'Manchester, United Kingdom', country: 'United Kingdom', label: 'Outside UK' },
        { place: 'Bengaluru, India', country: 'India', label: 'Outside India' },
        { place: 'Berlin, Germany', country: 'Germany', label: 'Outside Germany' },
        { place: 'Sydney, Australia', country: 'Australia', label: 'Outside Australia' },
        { place: 'São Paulo, Brazil', country: 'Brazil', label: 'Outside Brazil' },
    ];
    const roles: Array<{ resume: string; title: string; level: string }> = [
        { resume: 'vivek-tam-resume', title: 'Technical Account Manager', level: 'senior' },
        { resume: 'health-rn-resume', title: 'Registered Nurse', level: 'mid' },
        { resume: 'sample-resume', title: 'Senior Software Engineer', level: 'senior' },
    ];

    for (const role of roles) {
        it(`${role.resume}: a ${role.title} role in another country names it, in every country, on site or remote`, () => {
            for (const home of homes) {
                const resume = livingIn(fixture(role.resume), home.place);
                const signals = resolveCandidateSignals(resume);
                for (const there of homes) {
                    for (const workType of ['onsite', 'remote']) {
                        const job = mkJob({ title: role.title, experience_level: role.level, work_type: workType, location_country: there.country });
                        const score = scoreJobAgainstResume(resume, job, signals)!;
                        const at = `${home.country} résumé, ${workType} role in ${there.country}`;
                        assert.ok(score, at);
                        if (there.country === home.country) {
                            assert.equal(score.outside, undefined, at);
                            assert.ok(FIT_WORDS.includes(matchLabel(score)), at);
                            continue;
                        }
                        assert.equal(matchLabel(score), home.label, at);
                        assert.ok(score.total < MATCH_BAND_GOOD_MIN, at);
                        assert.deepEqual(score.outside!.home, [home.country], at);
                        assert.equal(score.outside!.where, there.country, at);
                        assert.match(explainMatch(score), new RegExp(`outside (the )?${home.country}, where your résumé places you`), at);
                    }
                }
            }
        });
    }

    it("Island's U.S. Federal TAM role reads Outside Canada for a résumé in Toronto, and a fit word in Austin", () => {
        const island = mkJob({ title: 'Technical Account Manager - U.S. Federal', company: 'Island', location: 'Remote', work_type: 'remote', experience_level: 'senior' });
        const resume = livingIn(fixture('vivek-tam-resume'), 'Toronto, Ontario, Canada');
        const score = scoreJobAgainstResume(resume, island, resolveCandidateSignals(resume))!;
        assert.equal(matchLabel(score), 'Outside Canada');
        assert.equal(
            explainMatch(score),
            "It's remote but based in the United States, outside Canada, where your résumé places you. " +
                "It's your own role: the title matches Technical Account Manager on your résumé. " +
                'If you can work there, add it under Relocation in Settings to see how well it fits.',
        );
        const inAustin = livingIn(resume, 'Austin, Texas, United States');
        const there = scoreJobAgainstResume(inAustin, island, resolveCandidateSignals(inAustin))!;
        assert.equal(there.outside, undefined);
        assert.ok(FIT_WORDS.includes(matchLabel(there)));
    });

    it("a title's territory narrows a wider country tag: U.S. Federal and NY/NJ tagged for North America read Outside Canada", () => {
        const resume = livingIn(fixture('vivek-tam-resume'), 'Toronto, Ontario, Canada');
        const signals = resolveCandidateSignals(resume);
        const federal = mkJob({ title: 'Technical Account Manager - U.S. Federal', location: 'Remote', work_type: 'remote', experience_level: 'senior', location_country: ['United States', 'Canada'] });
        const federalScore = scoreJobAgainstResume(resume, federal, signals)!;
        assert.equal(matchLabel(federalScore), 'Outside Canada');
        assert.equal(federalScore.outside!.where, 'United States');
        const nynj = mkJob({ title: 'Technical Account Manager (NY/NJ)', location: 'Remote - North America', work_type: 'remote', experience_level: 'senior' });
        assert.equal(matchLabel(scoreJobAgainstResume(resume, nynj, signals)!), 'Outside Canada');
        // The title's own country keeps its fit word, and a tag the title doesn't overlap stays.
        const canadaSide = mkJob({ title: 'Technical Account Manager - Canada Enterprise', work_type: 'remote', experience_level: 'senior', location_country: ['United States', 'Canada'] });
        assert.ok(FIT_WORDS.includes(matchLabel(scoreJobAgainstResume(resume, canadaSide, signals)!)));
        const inAustin = livingIn(resume, 'Austin, Texas, United States');
        assert.equal(matchLabel(scoreJobAgainstResume(inAustin, canadaSide, resolveCandidateSignals(inAustin))!), 'Outside US');
        const taggedCanada = mkJob({ title: 'Technical Account Manager - U.S. Federal', work_type: 'remote', experience_level: 'senior', location_country: 'Canada' });
        assert.ok(FIT_WORDS.includes(matchLabel(scoreJobAgainstResume(resume, taggedCanada, signals)!)));
    });

    it('a Settings place that names no country (an old "Toronto" search) leaves the résumé country in charge', () => {
        const island = mkJob({ title: 'Technical Account Manager - U.S. Federal', company: 'Island', location: 'Remote', work_type: 'remote', experience_level: 'senior' });
        const resume = livingIn(fixture('vivek-tam-resume'), 'Toronto, Ontario, Canada');
        for (const location of ['Toronto', 'Anywhere']) {
            const score = scoreJobAgainstResume(resume, island, resolveCandidateSignals(resume, prefs({ location })))!;
            assert.equal(matchLabel(score), 'Outside Canada', location);
            assert.equal(score.outside!.from, 'resume', location);
        }
        // The server's gazetteer read of the Settings city names the country when the résumé has none.
        const noPlace = livingIn(resume, '');
        const read = scoreJobAgainstResume(noPlace, island, resolveCandidateSignals(noPlace, { ...prefs({ location: 'Toronto' }), placeCountries: ['Canada'] }))!;
        assert.equal(matchLabel(read), 'Outside Canada');
        assert.equal(read.outside!.from, 'settings');
    });

    it('a country they said they would move to, or Settings placing them there, gives the role a fit word again', () => {
        const resume = livingIn(fixture('vivek-tam-resume'), 'Toronto, Ontario, Canada');
        const job = mkJob({ title: 'Technical Account Manager', experience_level: 'senior', work_type: 'onsite', location_country: 'United States' });
        const moving = scoreJobAgainstResume(resume, job, resolveCandidateSignals(resume, prefs({}, { relocation: 'Open to relocating to the US' })))!;
        assert.equal(moving.outside, undefined);
        assert.equal(matchLabel(moving), 'Strong');
        const anywhere = scoreJobAgainstResume(resume, job, resolveCandidateSignals(resume, prefs({}, { relocation: 'yes, anywhere' })))!;
        assert.equal(anywhere.outside, undefined);
        const settingsInUs = scoreJobAgainstResume(resume, job, resolveCandidateSignals(resume, prefs({ location: 'Seattle, WA' })))!;
        assert.equal(settingsInUs.outside, undefined);
    });

    it('says what the country was read from: Settings over the résumé', () => {
        const resume = livingIn(fixture('vivek-tam-resume'), 'Austin, Texas, United States');
        const job = mkJob({ title: 'Technical Account Manager', experience_level: 'senior', work_type: 'onsite', location_country: 'United States' });
        const score = scoreJobAgainstResume(resume, job, resolveCandidateSignals(resume, prefs({ location: 'Vancouver, BC' })))!;
        assert.equal(matchLabel(score), 'Outside Canada');
        assert.equal(score.outside!.from, 'settings');
        assert.match(explainMatch(score), /outside Canada, where your Settings place you\./);
    });

    it('ranks after every role they can take, in the same order among its own kind', () => {
        const resume = livingIn(fixture('vivek-tam-resume'), 'Toronto, Ontario, Canada');
        const signals = resolveCandidateSignals(resume);
        const ownAbroad = scoreJobAgainstResume(resume, mkJob({ title: 'Technical Account Manager', experience_level: 'senior', work_type: 'onsite', location_country: 'United States' }), signals)!;
        const familyHome = scoreJobAgainstResume(resume, mkJob({ title: 'Customer Success Manager', experience_level: 'senior', work_type: 'onsite', location_country: 'Canada' }), signals)!;
        assert.equal(ownAbroad.role, 'own');
        assert.equal(familyHome.outside, undefined);
        assert.ok(compareFit(familyHome, ownAbroad) < 0);
        assert.ok(compareFit(ownAbroad, null) < 0, 'an unscored role still sorts last');
    });

    it('shortens long country names, and reads "Abroad" for several countries or a name too long for a chip', () => {
        assert.equal(outsideLabel(['United States']), 'Outside US');
        assert.equal(outsideLabel(['United Arab Emirates']), 'Outside UAE');
        assert.equal(outsideLabel(['Netherlands']), 'Outside Netherlands');
        assert.equal(outsideLabel(['Canada', 'United States']), 'Abroad');
        assert.equal(outsideLabel(['Bosnia and Herzegovina']), 'Abroad');
    });
});

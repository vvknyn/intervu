import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    seniorityFromYears,
    experienceLevelFacet,
    resumeSeniority,
    resumeSeniorityBasis,
    buildMatchQuery,
    topSkills,
    capExploreTerms,
    buildExploreBroadenQuery,
    mergeFacets,
} from '../../src/lib/jobs/resume-match';
import { parseQuotedOrPhrases } from '../../src/lib/jobs/fit-phrases';
import { resumeDataFromPlainText } from '../../src/lib/resume/structure-resume-text';
import { jobLevel, scoreJobAgainstResume } from '../../src/lib/match/score';
import type { PublicJob } from '../../src/lib/jobs/types';
import type { ResumeData } from '../../src/types/resume';

/** Count title phrases after capExploreTerms (each ends in a common role suffix). */
function countCappedTitlePhrases(q: string): number {
    const suffix =
        /\b(Manager|Engineer|Lead|Owner|Developer|Analyst|Architect|Designer|Executive|Representative|Specialist|Scientist)\b/g;
    return [...q.matchAll(suffix)].length;
}

// Minimal ResumeData factory — the match builders only read profile + competencies.
function mk(
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

describe('resumeSeniority', () => {
    const NOW = new Date(2026, 9, 6);
    const resume = (years: number, roles: [string, string][], profession = ''): ResumeData =>
        ({
            profile: { name: 'T', profession, yearsOfExperience: years, location: '', email: '', phone: '', linkedin: '', website: '' },
            experience: roles.map(([role, dates], i) => ({ id: `e${i}`, company: 'Co', role, dates, description: '' })),
            competencies: [],
            education: [],
            generatedSummary: '',
        }) as unknown as ResumeData;

    it('reads the years in the line of work held now, carried up one step by a long career with lead or senior roles', () => {
        // Senior-aware fit (Vivek, 2026-10-13): total years plus lead and senior roles carry the level up one step.
        // 13 years in all, 5 of them as a TAM after 8 as a Senior Software Engineer: senior, and also fits mid.
        const changer = resume(13, [
            ['Technical Account Manager', 'September 2021 - Present'],
            ['Software Engineer', 'February 2013 - April 2018'],
        ]);
        assert.equal(resumeSeniority(changer, NOW), 'mid', 'no lead or senior title before: the years in the line set it');
        const tam = resume(13, [
            ['Technical Account Manager', 'September 2021 - Present'],
            ['Senior Software Engineer', 'February 2013 - April 2018'],
        ]);
        assert.equal(resumeSeniority(tam, NOW), 'senior');
        assert.equal(resumeSeniorityBasis(tam, NOW)?.led, true);
        assert.deepEqual(experienceLevelFacet(resumeSeniority(tam, NOW), tam), ['mid', 'senior', 'lead']);
    });
    it('counts every role of the same kind, so a promotion path stays senior', () => {
        const swe = resume(10, [
            ['Senior Software Engineer', 'Jan 2020 - Present'],
            ['Software Engineer', 'Jan 2016 - Dec 2019'],
        ]);
        assert.equal(resumeSeniority(swe, NOW), 'senior');
    });
    it('never reads higher than the whole career, and falls back to it when the role names no kind', () => {
        assert.equal(resumeSeniority(resume(2, [['Registered Nurse', '2015 - Present']]), NOW), 'entry');
        assert.equal(resumeSeniority(resume(9, [['Shift Supervisor', '2024 - Present']]), NOW), 'senior');
        assert.equal(resumeSeniority(resume(9, [['Registered Nurse', 'sometime']]), NOW), 'senior');
    });
    it('reads the title held now when it names a level, higher or lower than the years, the way a posting\'s title is read', () => {
        // 4 years as an accountant read mid; the title they hold says senior, as it would on a posting.
        const accountant = resume(6, [
            ['Senior Accountant', 'Jan 2024 - Present'],
            ['Staff Accountant', 'Jan 2022 - Dec 2023'],
        ]);
        assert.equal(resumeSeniority(accountant, NOW), 'senior');
        const lead = resume(5, [['Manager, Customer Success', 'Jan 2023 - Present'], ['Customer Success Manager', 'Jan 2021 - Dec 2022']]);
        assert.equal(resumeSeniority(lead, NOW), 'senior');
        // A rank-free title leaves the years' level alone.
        assert.equal(resumeSeniority(resume(13, [['Technical Account Manager', 'September 2021 - Present'], ['Software Engineer', 'February 2013 - April 2018']]), NOW), 'mid');
        // An intern, junior or co-op student now is entry level, however long the dates run (focus group, 2026-10-12:
        // a "Data Science Intern" since 2021 read as mid, and the Mid filter emptied their list).
        assert.equal(resumeSeniority(resume(8, [['Junior Developer', '2018 - Present']]), NOW), 'entry');
        assert.equal(resumeSeniority(resume(5, [['Data Science Intern', 'Jan 2021 - Present']]), NOW), 'entry');
        assert.equal(resumeSeniority(resume(5, [['Engineering Co-op Student', 'Jan 2021 - Present']]), NOW), 'entry');
        assert.equal(resumeSeniorityBasis(resume(5, [['Data Science Intern', 'Jan 2021 - Present']]), NOW)?.title, 'Data Science Intern');
        // Only the title held now: an internship years ago doesn't hold a career down.
        assert.equal(resumeSeniority(resume(8, [['Data Scientist', 'Jan 2020 - Present'], ['Data Science Intern', 'May 2019 - Dec 2019']]), NOW), 'senior');
    });
});

describe('jobLevel', () => {
    const job = (title: string, experience_level: string | null, min_years_experience?: number) =>
        ({ title, experience_level: experience_level as string, min_years_experience });
    it('takes the highest of the listed level, the title and the years asked, except that an explicit entry title wins', () => {
        assert.equal(jobLevel(job('Senior Technical Account Manager', 'mid')), 'senior');
        assert.equal(jobLevel(job('Technical Account Manager', 'mid', 8)), 'senior');
        assert.equal(jobLevel(job('Technical Account Manager', 'senior', 3)), 'senior');
        assert.equal(jobLevel(job('Technical Account Manager', 'entry', 4)), 'mid');
        // An entry word in the title ("Junior", "Intern") is the employer saying so outright; a listing that read mid does not outweigh it.
        assert.equal(jobLevel(job('Junior Accountant', 'mid')), 'entry');
    });
    it('reads the years asked on the same scale as a candidate\'s years, and ignores implausible ones', () => {
        assert.equal(jobLevel(job('Accountant', null, 2)), 'entry');
        assert.equal(jobLevel(job('Accountant', null, 5)), 'mid');
        assert.equal(jobLevel(job('Accountant', null, 7)), 'senior');
        assert.equal(jobLevel(job('Accountant', null, 0)), null);
        assert.equal(jobLevel(job('Accountant', null, 75)), null);
    });
    it('reads a title that runs a team as senior, and one that names the work as no level', () => {
        for (const title of ['Manager, Customer Success (Enterprise)', 'Manager of Nursing', 'Manager - Payroll', 'Manager: Store Operations', 'Manager (Technical Account Management)']) {
            assert.equal(jobLevel(job(title, null)), 'senior', title);
        }
        for (const title of ['Customer Success Manager', 'Account Manager - Insurance', 'Product Manager, Growth', 'Assistant Manager', 'Manager']) {
            assert.equal(jobLevel(job(title, null)), null, title);
        }
    });
    it('reads the title when no level is listed', () => {
        assert.equal(jobLevel(job('Senior Technical Account Manager', null)), 'senior');
        assert.equal(jobLevel(job('Director, Customer Success', 'unknown')), 'senior');
        assert.equal(jobLevel(job('Junior Accountant', null)), 'entry');
        assert.equal(jobLevel(job('Technical Account Manager', null)), null);
    });
    it("doesn't read care for seniors or lead generation as a rank", () => {
        assert.equal(jobLevel(job('Senior Care Aide', null)), null);
        assert.equal(jobLevel(job('Lead Generation Specialist', null)), null);
    });
});

describe('seniorityFromYears', () => {
    it('maps 0 / negative / NaN to null (no facet)', () => {
        assert.equal(seniorityFromYears(0), null);
        assert.equal(seniorityFromYears(-3), null);
        assert.equal(seniorityFromYears(NaN), null);
    });
    it('maps 1–2 years to entry', () => {
        assert.equal(seniorityFromYears(1), 'entry');
        assert.equal(seniorityFromYears(2), 'entry');
    });
    it('maps 3–6 years to mid', () => {
        assert.equal(seniorityFromYears(3), 'mid');
        assert.equal(seniorityFromYears(6), 'mid');
    });
    it('maps 7+ years to senior', () => {
        assert.equal(seniorityFromYears(7), 'senior');
        assert.equal(seniorityFromYears(25), 'senior');
    });
});

describe('buildMatchQuery', () => {
    it('uses profession and engineer adjacents when there is no experience (role-ish, not skills)', () => {
        const out = buildMatchQuery(mk({ profession: '  Senior Backend Engineer  ', yearsOfExperience: 8 }));
        assert.ok(out.q.length > 0);
        assert.match(out.q, /backend engineer|software engineer|senior backend engineer/i);
        assert.doesNotMatch(out.q, /\bgo\b|\bkafka\b/i);
    });
    it('derives no facets at any seniority: the résumé ranks, it never filters', () => {
        for (const yearsOfExperience of [0, 4, 8]) {
            assert.deepEqual(buildMatchQuery(mk({ profession: 'X', yearsOfExperience })).facets, {}, String(yearsOfExperience));
        }
    });
    it('falls back to top skills when profession is missing (skills-only résumé)', () => {
        const out = buildMatchQuery(
            mk({ profession: '', yearsOfExperience: 5 }, [{ category: 'Tech', skills: ['Go', 'Kafka', 'AWS'] }]),
        );
        assert.equal(out.q, '"Go" OR "Kafka" OR "AWS"');
        assert.deepEqual(out.phrases, ['Go', 'Kafka', 'AWS']);
    });
    it('prefers role titles over skills when a résumé has both', () => {
        const out = buildMatchQuery(
            mk({ profession: 'Backend Engineer', yearsOfExperience: 5 }, [{ category: 'Tech', skills: ['Go', 'Kafka'] }]),
        );
        assert.match(out.q, /backend engineer|software engineer/i);
        assert.doesNotMatch(out.q, /\bgo\b|\bkafka\b/i);
    });
    it('returns empty q when profession, experience titles, and skills are all absent', () => {
        const out = buildMatchQuery(mk({ profession: '', yearsOfExperience: 5 }));
        assert.equal(out.q, '');
    });
    it('clinical coordinator with patient-care duties surfaces Nurse titles from duties, not headline', () => {
        const resume = mk(
            { profession: 'Clinical Coordinator', yearsOfExperience: 6 },
            [],
            [{
                id: '1',
                company: 'Metro Health',
                role: 'Clinical Coordinator',
                dates: '2019',
                description: [
                    'Coordinated patient care across units.',
                    'Performed triage and medication reconciliation at bedside.',
                ].join('\n'),
            }],
        );
        const { q } = buildMatchQuery(resume);
        assert.match(q, /registered nurse|nurse/i, `expected clinical retrieval title, got: ${q}`);

        const nurseJob = {
            id: 'rn-1',
            title: 'Registered Nurse',
            company: 'Metro Health',
            location: null,
            work_type: 'onsite',
            description: null,
            employment_type: 'full_time',
            experience_level: 'mid',
            salary_min: null,
            salary_max: null,
            salary_currency: null,
            salary_period: null,
            visa_sponsorship: null,
            tags: ['patient care'],
            apply_url: 'https://example.com',
            source: 'test',
            posted_at: null,
            first_seen_at: null,
            updated_at: null,
            vacancy_status: 'open',
            ghost_badge: 'unscored',
        } as PublicJob;
        const sweJob = { ...nurseJob, id: 'swe-1', title: 'Software Engineer', tags: ['javascript'] };

        const rnScore = scoreJobAgainstResume(resume, nurseJob)!.total;
        const sweScore = scoreJobAgainstResume(resume, sweJob)!.total;
        assert.ok(rnScore > sweScore, `RN (${rnScore}) should beat SWE (${sweScore})`);
    });

    it('caps emitted role titles to at most 4 phrases', () => {
        const out = buildMatchQuery(
            mk(
                {
                    profession: 'Customer Success Operations Manager | Technical Account Management',
                    yearsOfExperience: 12,
                },
                [],
                [
                    {
                        id: '1',
                        role: 'Client-facing Product Manager',
                        company: 'Co',
                        dates: '2021',
                        description: '',
                    },
                    { id: '2', role: 'Technology Lead', company: 'Co', dates: '2019', description: '' },
                    { id: '3', role: 'Team Lead', company: 'Co', dates: '2018', description: '' },
                    { id: '4', role: 'Senior Software Engineer', company: 'Co', dates: '2013', description: '' },
                ],
            ),
        );
        assert.ok(out.phrases.length <= 4, `expected ≤4 phrases, got ${out.phrases.length}`);
        assert.ok(
            countCappedTitlePhrases(out.q) <= 4,
            `expected ≤4 capped title phrases, got ${countCappedTitlePhrases(out.q)}: ${out.q}`,
        );
    });

    it('emits quoted-OR q for multi-title Rank queries instead of space-joining', () => {
        const out = buildMatchQuery(
            mk(
                { profession: 'Customer Success Operations Manager', yearsOfExperience: 12 },
                [],
                [
                    {
                        id: '1',
                        role: 'Client-facing Product Manager',
                        company: 'Co',
                        dates: '2021',
                        description: '',
                    },
                    { id: '2', role: 'Technology Lead', company: 'Co', dates: '2019', description: '' },
                    { id: '3', role: 'Team Lead', company: 'Co', dates: '2018', description: '' },
                    { id: '4', role: 'Senior Software Engineer', company: 'Co', dates: '2013', description: '' },
                ],
            ),
        );
        assert.match(out.q, / OR /, 'multi-title q must use OR');
        assert.notEqual(out.q, out.phrases.join(' '), 'must not space-join titles');
        const parsed = parseQuotedOrPhrases(out.q);
        assert.ok(parsed, 'q must be parseable as quoted-OR');
        for (const phrase of out.phrases) {
            assert.ok(parsed!.some((p) => p.toLowerCase() === phrase.toLowerCase()), `q must include phrase: ${phrase}`);
        }
    });

    it('well-formed OR query does not require one hit to contain engineer and PM tokens', () => {
        const out = buildMatchQuery(
            mk(
                { profession: 'Product Manager', yearsOfExperience: 8 },
                [],
                [
                    { id: '1', role: 'Product Manager', company: 'Co', dates: '2024 — Present', description: '' },
                    // Recent enough to still count (`STALE_ROLE_YEARS`).
                    { id: '2', role: 'Software Engineer', company: 'Co', dates: '2021 — 2024', description: '' },
                ],
            ),
        );
        const parsed = parseQuotedOrPhrases(out.q);
        assert.ok(parsed, 'multi-phrase Rank q must be quoted-OR');
        assert.ok(parsed!.some((p) => /product manager/i.test(p)));
        assert.ok(parsed!.some((p) => /software engineer/i.test(p)));
        // Each phrase is retrieved independently — PM-only titles need not also say Engineer.
        for (const phrase of parsed!) {
            assert.ok(phrase.length > 0);
            assert.ok(!phrase.includes(' OR '), `phrase must be atomic, got: ${phrase}`);
        }
    });
});

describe('topSkills', () => {
    it('flattens competencies, trims, dedupes case-insensitively, caps at n', () => {
        const r = mk({}, [
            { category: 'A', skills: ['React', ' react ', 'TypeScript'] },
            { category: 'B', skills: ['Node.js', 'GraphQL', 'Postgres', 'Docker'] },
        ]);
        assert.deepEqual(topSkills(r, 4), ['React', 'TypeScript', 'Node.js', 'GraphQL']);
    });
    it('returns [] when there are no competencies', () => {
        assert.deepEqual(topSkills(mk({})), []);
    });
});

describe('capExploreTerms', () => {
    it('caps an over-long list to the 4 most significant (earliest-ranked) terms', () => {
        // Measured failure case: joining every AI-suggested title (6-8,
        // often multi-word) produced a 100k-hit relevance mush.
        const titles = [
            'Senior Backend Engineer',
            'Platform Engineering Manager',
            'DevOps Team Lead',
            'Site Reliability Engineer',
            'Infrastructure Architect',
            'Staff Software Engineer',
        ];
        assert.deepEqual(capExploreTerms(titles), [
            'Senior Backend Engineer',
            'Platform Engineering Manager',
            'DevOps Team Lead',
            'Site Reliability Engineer',
        ]);
    });
    it('dedupes case-insensitively and trims, without spending a slot on a repeat', () => {
        assert.deepEqual(capExploreTerms(['Go', ' go ', 'Kafka', 'AWS', 'Docker']), ['Go', 'Kafka', 'AWS', 'Docker']);
    });
    it('passes a short list through unchanged', () => {
        assert.deepEqual(capExploreTerms(['Go', 'Kafka']), ['Go', 'Kafka']);
    });
    it('respects a custom max', () => {
        assert.deepEqual(capExploreTerms(['a', 'b', 'c', 'd'], 2), ['a', 'b']);
    });
});

describe('buildExploreBroadenQuery', () => {
    it('joins top skills into a single broadened query', () => {
        const r = mk({ profession: 'Backend Engineer', yearsOfExperience: 9 }, [
            { category: 'Tech', skills: ['Go', 'Kafka', 'AWS'] },
        ]);
        assert.equal(buildExploreBroadenQuery(r).q, 'Go Kafka AWS');
    });
    it('returns empty q when there are no skills', () => {
        assert.equal(buildExploreBroadenQuery(mk({ profession: 'X', yearsOfExperience: 3 })).q, '');
    });
    it('caps a long skills list to 4 terms in the emitted query', () => {
        const r = mk({ profession: 'Backend Engineer', yearsOfExperience: 9 }, [
            { category: 'Tech', skills: ['Go', 'Kafka', 'AWS', 'Docker', 'Kubernetes', 'Postgres'] },
        ]);
        assert.equal(buildExploreBroadenQuery(r).q, 'Go Kafka AWS Docker');
    });
});

describe('mergeFacets', () => {
    it('unions résumé-derived facets with user-applied ones without mutating inputs', () => {
        const current = { work_type: ['remote'], experience_level: ['mid'] };
        const derived = { experience_level: ['senior'] };
        const merged = mergeFacets(current, derived);
        assert.deepEqual(merged, {
            work_type: ['remote'],
            experience_level: ['mid', 'senior'],
        });
        assert.deepEqual(current, { work_type: ['remote'], experience_level: ['mid'] });
    });

    it('is commutative regardless of which side had the facet first', () => {
        const userFirst = mergeFacets(
            { work_type: ['remote'], experience_level: ['mid'] },
            { experience_level: ['senior'] },
        );
        const fitFirst = mergeFacets(
            { experience_level: ['senior'] },
            { work_type: ['remote'], experience_level: ['mid'] },
        );
        assert.deepEqual(userFirst, fitFirst);
    });

    it('dedupes identical values on the same facet key', () => {
        const merged = mergeFacets({ experience_level: ['senior'] }, { experience_level: ['senior'] });
        assert.deepEqual(merged.experience_level, ['senior']);
    });
});

describe('mergeFacets', () => {
    it('is commutative — same union regardless of argument order for disjoint keys', () => {
        const location = { location_country: ['CA'] };
        const seniority = { experience_level: ['senior'] };
        assert.deepEqual(mergeFacets(location, seniority), mergeFacets(seniority, location));
    });

    it('unions values on the same key without duplicates', () => {
        const a = { work_type: ['remote'] };
        const b = { work_type: ['remote', 'hybrid'] };
        assert.deepEqual(mergeFacets(a, b), { work_type: ['hybrid', 'remote'] });
        assert.deepEqual(mergeFacets(b, a), { work_type: ['hybrid', 'remote'] });
    });

    it('does not mutate inputs', () => {
        const current = { location_country: ['US'] };
        const derived = { experience_level: ['senior'] };
        mergeFacets(current, derived);
        assert.deepEqual(current, { location_country: ['US'] });
        assert.deepEqual(derived, { experience_level: ['senior'] });
    });
});

/**
 * Focus group, 2026-10-12: the titles a résumé's search adds drifted off its
 * line of work. A Customer Success Manager searched "Product Manager", a web
 * developer "Backend Engineer". Added titles now stay close to the résumé's
 * own (same family, or a shared word of the line of work); synthetic one-page
 * résumés like the study's, read the way an upload is.
 */
describe('buildMatchQuery keeps added titles in the résumé\'s own line of work', () => {
    const read = (text: string) => resumeDataFromPlainText(text) as ResumeData;
    const searched = (text: string) => buildMatchQuery(read(text), 2026).phrases;
    const CSM = `Sample Jamal
Customer Success Manager
Austin, TX | sample@example.com

Summary
Customer success manager for B2B SaaS accounts, onboarding to renewal.

Experience
Customer Success Manager | HubSpot | Austin, TX | Jan 2021 – Present
• Managed a book of 60 mid-market accounts worth $4M ARR with 95% gross retention.
• Ran onboarding, QBRs and renewals; partnered with product on roadmap feedback.
• Reduced churn 15% with health scores in Gainsight.

Education
BBA Marketing | University of Texas at Austin | 2018

Skills
Gainsight, Salesforce, Onboarding, Renewals, QBRs, Churn Reduction, SaaS`;
    const WEB = `Sample Frank
Web Developer
Toronto, ON | sample@example.com

Summary
Career changer and bootcamp graduate building web applications in JavaScript and React.

Experience
Web Developer | Freelance | Toronto, ON | Jan 2021 – Present
• Built React and Node.js websites for small businesses.
• Set up Express APIs with MongoDB and deployed on Heroku.

Education
Full-Stack Web Development Bootcamp | Lighthouse Labs | 2020

Skills
JavaScript, React, Node.js, Express, HTML, CSS, MongoDB, Git`;
    const INTERN = `Sample Arjun
Data Science Intern
Montreal, QC | sample@example.com

Summary
Graduate student in data science looking for an internship or new grad role. Python, SQL and machine learning.

Experience
Data Science Intern | Ubisoft | Montreal, QC | Jan 2021 – Present
• Built churn models in Python and scikit-learn on player telemetry.
• Wrote SQL dashboards in Tableau for the live-ops team.

Education
MSc Data Science | Concordia University | 2025

Skills
Python, SQL, Pandas, scikit-learn, Tableau, Statistics`;

    it('a Customer Success Manager searches customer success titles, not Product Manager', () => {
        assert.deepEqual(searched(CSM), ['Customer Success Manager', 'Technical Account Manager']);
    });

    it('a web developer searches developer titles, not Backend Engineer', () => {
        const titles = searched(WEB);
        assert.equal(titles[0], 'Web Developer');
        assert.ok(!titles.includes('Backend Engineer'), titles.join(', '));
        assert.ok(titles.includes('Full Stack Developer'), titles.join(', '));
    });

    it('a data science intern keeps the data titles that share its line of work', () => {
        const q = buildMatchQuery(read(INTERN), 2026);
        assert.deepEqual(q.phrases, ['Data Science Intern', 'Data Analyst', 'Data Engineer']);
    });
});

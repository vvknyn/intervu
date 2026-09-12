import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    seniorityFromYears,
    buildMatchQuery,
    topSkills,
    capExploreTerms,
    buildExploreBroadenQuery,
    mergeFacets,
} from '../../src/lib/jobs/resume-match';
import { scoreJobAgainstResume } from '../../src/lib/match/score';
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
    it('widens seniority to mid+senior so adjacent mid-level roles stay visible', () => {
        const out = buildMatchQuery(mk({ profession: 'X', yearsOfExperience: 8 }));
        assert.deepEqual(out.facets.experience_level, ['mid', 'senior']);
    });
    it('derives mid-only experience_level for mid seniority', () => {
        const out = buildMatchQuery(mk({ profession: 'X', yearsOfExperience: 4 }));
        assert.deepEqual(out.facets.experience_level, ['mid']);
    });
    it('omits experience_level when years is 0/unknown', () => {
        const out = buildMatchQuery(mk({ profession: 'X', yearsOfExperience: 0 }));
        assert.equal(out.facets.experience_level, undefined);
    });
    it('falls back to top skills when profession is missing (skills-only résumé)', () => {
        const out = buildMatchQuery(
            mk({ profession: '', yearsOfExperience: 5 }, [{ category: 'Tech', skills: ['Go', 'Kafka', 'AWS'] }]),
        );
        assert.equal(out.q, 'Go Kafka AWS');
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
        assert.ok(
            countCappedTitlePhrases(out.q) <= 4,
            `expected ≤4 capped title phrases, got ${countCappedTitlePhrases(out.q)}: ${out.q}`,
        );
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

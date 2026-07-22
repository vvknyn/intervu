import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    seniorityFromYears,
    buildMatchQuery,
    topSkills,
    capExploreTerms,
    buildExploreBroadenQuery,
    resolveExploreOutcome,
} from '../../src/lib/jobs/resume-match';
import type { ResumeData } from '../../src/types/resume';

// Minimal ResumeData factory — the match builders only read profile + competencies.
function mk(
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
    it('uses profession as the query, trimmed', () => {
        const out = buildMatchQuery(mk({ profession: '  Senior Backend Engineer  ', yearsOfExperience: 8 }));
        assert.equal(out.q, 'Senior Backend Engineer');
    });
    it('derives the experience_level facet from years', () => {
        const out = buildMatchQuery(mk({ profession: 'X', yearsOfExperience: 4 }));
        assert.deepEqual(out.facets.experience_level, ['mid']);
    });
    it('omits experience_level when years is 0/unknown', () => {
        const out = buildMatchQuery(mk({ profession: 'X', yearsOfExperience: 0 }));
        assert.equal(out.facets.experience_level, undefined);
    });
    it('returns empty q when profession is missing', () => {
        const out = buildMatchQuery(mk({ profession: '', yearsOfExperience: 5 }));
        assert.equal(out.q, '');
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

// Explore is auth-gated (src/app/jobs/page.tsx's `runExplore`), so its
// success/error branching can't be exercised by an anonymous browser check —
// this pure extraction is what makes the class of bug in the prod screenshot
// (infinite "Finding live roles…" spinner) verifiable at all: `settled: null`
// is what a timeout/thrown rejection from the settle-guarded suggest call
// (`EXPLORE_SUGGEST_TIMEOUT_MS`) collapses to.
describe('resolveExploreOutcome', () => {
    const resume = mk({ profession: 'Backend Engineer', yearsOfExperience: 9 }, [
        { category: 'Tech', skills: ['Go', 'Kafka', 'AWS', 'Docker', 'Kubernetes'] },
    ]);

    it('settled: null (timeout or thrown rejection) → failed, never a silent fallback', () => {
        assert.deepEqual(resolveExploreOutcome(null, resume, null), { kind: 'failed' });
    });

    it('success: q is capped to 4 terms, but titles itself stays uncapped (for the per-title chip row)', () => {
        const titles = ['A Title', 'B Title', 'C Title', 'D Title', 'E Title'];
        assert.deepEqual(resolveExploreOutcome({ titles }, resume, null), {
            kind: 'success',
            q: 'A Title B Title C Title D Title',
            titles,
        });
    });

    it('res.error + auth sentinel → auth, regardless of whether a fallback query exists', () => {
        assert.deepEqual(resolveExploreOutcome({ error: 'AUTH_REQUIRED: sign in' }, resume, 'auth'), {
            kind: 'auth',
        });
    });

    it('res.error + credits sentinel → fallback with credits: true', () => {
        assert.deepEqual(resolveExploreOutcome({ error: 'OUT_OF_CREDITS' }, resume, 'credits'), {
            kind: 'fallback',
            q: 'Go Kafka AWS Docker',
            credits: true,
        });
    });

    it('res.error, no sentinel (e.g. NO_SUGGESTIONS) → fallback with credits: false', () => {
        assert.deepEqual(resolveExploreOutcome({ error: 'NO_SUGGESTIONS' }, resume, null), {
            kind: 'fallback',
            q: 'Go Kafka AWS Docker',
            credits: false,
        });
    });

    it('res.error + no skills to fall back on → no-fallback', () => {
        const bare = mk({ profession: '', yearsOfExperience: 0 });
        assert.deepEqual(resolveExploreOutcome({ error: 'NO_SUGGESTIONS' }, bare, null), { kind: 'no-fallback' });
    });
});

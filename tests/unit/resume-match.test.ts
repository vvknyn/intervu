import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    seniorityFromYears,
    buildMatchQuery,
    topSkills,
    buildExploreBroadenQuery,
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
});

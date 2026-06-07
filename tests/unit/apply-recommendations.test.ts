import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Test the REAL shared chokepoint (tsx resolves the @/ alias from tsconfig).
import {
    applyRecommendations,
    fuzzyReplace,
    normalizeForMatch,
} from '@/lib/resume/apply-recommendations';
import type { ResumeData, TailoringRecommendation } from '@/types/resume';

function baseResume(overrides: Partial<ResumeData> = {}): ResumeData {
    return {
        profile: {
            profession: 'Software Engineer',
            yearsOfExperience: 5,
            location: 'NYC',
            email: 'a@b.com',
            phone: '555',
        },
        experience: [
            {
                id: 'e1',
                company: 'Acme',
                role: 'Engineer',
                dates: '2020-2023',
                description: 'Built a real-time pipeline processing 2M events per second.',
            },
        ],
        competencies: [
            { category: 'Languages', skills: ['TypeScript', 'Python', 'Go'] },
        ],
        education: [],
        generatedSummary: 'Engineer with 5 years of experience.',
        ...overrides,
    };
}

function rec(partial: Partial<TailoringRecommendation>): TailoringRecommendation {
    return {
        id: partial.id || 'r1',
        category: partial.category || 'summary',
        priority: partial.priority || 'high',
        title: partial.title || 'Title',
        reasoning: partial.reasoning || 'because',
        suggested: partial.suggested ?? 'suggested',
        original: partial.original,
    };
}

describe('normalizeForMatch', () => {
    it('collapses whitespace, lowercases, and unifies smart quotes', () => {
        assert.equal(normalizeForMatch('  Hello   World  '), 'hello world');
        assert.equal(normalizeForMatch('don’t'), normalizeForMatch("don't"));
        assert.equal(normalizeForMatch('A​B'), 'ab'); // zero-width stripped
    });
});

describe('fuzzyReplace', () => {
    it('replaces an exact substring', () => {
        assert.equal(fuzzyReplace('foo bar baz', 'bar', 'QUX'), 'foo QUX baz');
    });

    it('replaces despite differing whitespace (the applications.tsx bug)', () => {
        // The model returns `original` with single spaces; the resume text has a
        // newline + double space. Old code used includes() and silently no-op'd.
        const haystack = 'Led the\n  migration to React.';
        const out = fuzzyReplace(haystack, 'Led the migration to React.', 'Drove the React migration.');
        assert.equal(out, 'Drove the React migration.');
    });

    it('matches case-insensitively', () => {
        assert.equal(fuzzyReplace('Owned the Dashboard', 'owned the dashboard', 'Rebuilt it'), 'Rebuilt it');
    });

    it('leaves the text UNCHANGED when there is no acceptable match', () => {
        const haystack = 'Completely unrelated content.';
        assert.equal(fuzzyReplace(haystack, 'something not present', 'X'), haystack);
    });

    it('is a no-op when original is empty', () => {
        assert.equal(fuzzyReplace('abc', '', 'X'), 'abc');
    });
});

describe('applyRecommendations', () => {
    it('applies a summary rec by replacing the whole summary', () => {
        const out = applyRecommendations(baseResume(), [
            rec({ category: 'summary', suggested: 'Staff engineer, 5y, distributed systems.' }),
        ]);
        assert.equal(out.tailoredSummary, 'Staff engineer, 5y, distributed systems.');
    });

    it('applies an experience rec via fuzzy match on whitespace difference', () => {
        // original differs from stored description only by whitespace.
        const out = applyRecommendations(baseResume(), [
            rec({
                category: 'experience',
                original: 'Built a real-time pipeline   processing 2M events per second.',
                suggested: 'Architected a 2M-events/sec real-time pipeline.',
            }),
        ]);
        assert.equal(out.tailoredExperience[0].description, 'Architected a 2M-events/sec real-time pipeline.');
    });

    it('applies a skills rec by case-insensitive skill match', () => {
        const out = applyRecommendations(baseResume(), [
            rec({ category: 'skills', original: 'python', suggested: 'Python 3' }),
        ]);
        assert.deepEqual(out.tailoredCompetencies[0].skills, ['TypeScript', 'Python 3', 'Go']);
    });

    it('applies a skills rec that renames a competency category', () => {
        const out = applyRecommendations(baseResume(), [
            rec({ category: 'skills', original: 'Languages', suggested: 'Programming Languages' }),
        ]);
        assert.equal(out.tailoredCompetencies[0].category, 'Programming Languages');
    });

    it('ignores overall recs and never mutates the input resume', () => {
        const resume = baseResume();
        const before = JSON.stringify(resume);
        const out = applyRecommendations(resume, [
            rec({ category: 'overall', suggested: 'Reorder sections.' }),
        ]);
        // input untouched
        assert.equal(JSON.stringify(resume), before);
        // overall rec changes nothing
        assert.equal(out.tailoredSummary, resume.generatedSummary);
        assert.deepEqual(out.tailoredExperience, resume.experience);
        // returned arrays are copies, not the same references
        assert.notEqual(out.tailoredExperience, resume.experience);
        assert.notEqual(out.tailoredCompetencies[0].skills, resume.competencies[0].skills);
    });

    it('applies multiple recs across categories in one pass', () => {
        const out = applyRecommendations(baseResume(), [
            rec({ id: 'a', category: 'summary', suggested: 'New summary.' }),
            rec({ id: 'b', category: 'skills', original: 'Go', suggested: 'Golang' }),
        ]);
        assert.equal(out.tailoredSummary, 'New summary.');
        assert.deepEqual(out.tailoredCompetencies[0].skills, ['TypeScript', 'Python', 'Golang']);
    });
});

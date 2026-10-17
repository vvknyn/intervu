/**
 * A new résumé replaces what the old one filled, and a long career carries its level into a new
 * line of work (Vivek, 2026-10-13: "every time I upload a new resume the recommendations do not
 * auto refresh"; the other portals' picks were all Senior, Staff or Head of Product).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resumePreferencePatch } from '../../src/lib/agent/resume-preferences';
import { experienceLevelFacet, resumeSeniority } from '../../src/lib/jobs/resume-match';
import { conceptCoverage } from '../../src/lib/match/jd-match';
import { resumeDataFromPlainText } from '../../src/lib/resume/structure-resume-text';
import type { ResumeData } from '../../src/types/resume';

const fixture = (name: string) => readFileSync(path.join(process.cwd(), `tests/fixtures/${name}.txt`), 'utf8');
const r = (profession: string, role: string): ResumeData =>
    ({ profile: { name: 'A', profession, location: 'Toronto, Ontario' }, experience: [{ id: 'e', company: 'X', role, dates: '2020 - Present', description: '' }], competencies: [], education: [], generatedSummary: `${profession} with experience.` }) as unknown as ResumeData;

describe('a new résumé replaces the roles the old one filled', () => {
    const oldResume = r('Customer Success Manager', 'Customer Success Manager');
    const newResume = r('Registered Nurse', 'Registered Nurse');
    it('even when the old roles were saved without a source (setup, before sources were kept)', () => {
        const patch = resumePreferencePatch({ search: { query: 'Customer Success Manager' } as never, sources: {} }, newResume, oldResume);
        assert.equal(patch?.query, 'Registered Nurse');
    });
    it('never what the person typed themselves', () => {
        const patch = resumePreferencePatch({ search: { query: 'Data Analyst' } as never, sources: {} }, newResume, oldResume);
        assert.equal(patch?.query, undefined);
    });
});

describe('a long career carries a level into a new line of work', () => {
    it('5 years as a PM after lead and senior roles, 13 in all, reads senior: total years plus lead roles', () => {
        const pm = resumeDataFromPlainText(fixture('vivek-tam-resume'));
        // The fixture is the same career; its level must not drop to mid for the line-of-work years alone.
        assert.equal(resumeSeniority(pm), 'senior');
        assert.deepEqual(experienceLevelFacet('mid', pm), ['mid', 'senior', 'lead']);
        assert.deepEqual(experienceLevelFacet('mid', r('Nurse', 'Nurse')), ['mid']);
    });
});

describe('concept coverage', () => {
    it('reads the kinds of work a PM posting asks for in other words', () => {
        const resume = r('Product Manager', 'Product Manager');
        (resume as any).experience[0].description = 'Owned product roadmap and vision, backlog grooming and prioritization, requirements analysis, stakeholder management, launches.';
        const c = conceptCoverage(resume, { req: [], duty: ['product strategies', 'prioritize initiatives', 'define requirements', 'release coordination', 'cross-functional alignment'] });
        assert.ok(c && c.share >= 0.6, JSON.stringify(c));
    });
    it('names nothing when the posting names under three kinds of work', () => {
        assert.equal(conceptCoverage(r('Nurse', 'Nurse'), { req: ['icu'], duty: ['patients'] }), null);
    });
});

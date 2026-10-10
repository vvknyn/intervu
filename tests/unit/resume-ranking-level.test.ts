import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rankingLevel } from '../../src/lib/resume/ranking-level';
import { modelReadNeeded } from '../../src/lib/local-ai/parse-confidence';
import { stopAtDeadline } from '../../src/lib/local-ai/engines/transformers-wasm';
import { structureResumeText } from '../../src/lib/resume/structure-resume-text';
import type { AgentPreferences } from '../../src/lib/agent/preferences';
import type { ResumeData } from '../../src/types/resume';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The résumé review's "Level used for ranking" (ResumeReviewFields) is the
 * level fit labels compare roles against, worded with what it was read from,
 * and the on-device model only re-reads a résumé the quick read left short.
 * Invented people; the shapes are the ones real résumés take.
 */

const NOW = new Date(2026, 9, 10);

const resume = (years: number, roles: [string, string][], profession = ''): ResumeData =>
    ({
        profile: { name: 'T', profession, yearsOfExperience: years, location: '', email: '', phone: '', linkedin: '', website: '' },
        experience: roles.map(([role, dates], i) => ({ id: `e${i}`, company: 'Co', role, dates, description: '' })),
        competencies: [],
        education: [],
        generatedSummary: '',
    }) as unknown as ResumeData;

const prefs = (experienceLevel: string, configured = true): AgentPreferences => ({
    configured,
    search: { experienceLevel },
    answers: { custom: {} },
});

// 13 years in all: 5 as a Technical Account Manager after leading teams and 5 in engineering.
const CAREER_CHANGER = resume(
    13,
    [
        ['Technical Account Manager', 'September 2021 - Present'],
        ['Technology Lead', 'July 2019 - February 2020'],
        ['Team Lead', 'May 2018 - May 2019'],
        ['Senior Software Engineer', 'February 2013 - April 2018'],
    ],
    'Technical Account Manager',
);

describe('rankingLevel', () => {
    it('a career changer reads at the level of their years in the role they hold now, and the review marks those roles', () => {
        const level = rankingLevel(CAREER_CHANGER, null, NOW);
        assert.equal(level.level, 'mid');
        assert.equal(level.from, 'resume');
        assert.deepEqual(level.countedRoles, [0]);
        assert.equal(
            level.detail,
            'From your 5 years as a Technical Account Manager, the role marked below. Employers ask for years in the role, so your other roles count toward your 13 years in total, not this level.',
        );
    });

    it('a promotion path counts every role of the same kind', () => {
        const nurse = resume(11, [
            ['Charge Nurse', 'Jan 2021 - Present'],
            ['Registered Nurse', 'Jan 2015 - Dec 2020'],
        ], 'Registered Nurse');
        const level = rankingLevel(nurse, null, NOW);
        assert.equal(level.level, 'senior');
        assert.deepEqual(level.countedRoles, []);
        assert.equal(level.detail, 'From your 11 years of experience.');
    });

    it('a teacher who was a nurse reads at the level of their teaching years', () => {
        const teacher = resume(10, [
            ['Primary Teacher', 'Sep 2024 - Present'],
            ['Registered Nurse', 'Jan 2016 - Jun 2024'],
        ]);
        const level = rankingLevel(teacher, null, NOW);
        assert.equal(level.level, 'entry');
        assert.deepEqual(level.countedRoles, [0]);
        assert.match(level.detail, /^From your 2 years as a Primary Teacher, the role marked below\./);
    });

    it("Settings' Experience level comes first, and the review says what the résumé alone reads", () => {
        const level = rankingLevel(CAREER_CHANGER, prefs('senior'), NOW);
        assert.equal(level.level, 'senior');
        assert.equal(level.from, 'settings');
        assert.deepEqual(level.countedRoles, []);
        assert.equal(
            level.detail,
            'From the Experience level you set in Settings (Senior), which comes before your résumé. Your résumé alone reads mid level, from your 5 years as a Technical Account Manager.',
        );
    });

    it('preferences never saved, or saved with no level, leave the résumé to decide', () => {
        assert.equal(rankingLevel(CAREER_CHANGER, prefs('senior', false), NOW).from, 'resume');
        assert.equal(rankingLevel(CAREER_CHANGER, prefs(''), NOW).from, 'resume');
    });

    it('no years anywhere says so instead of guessing', () => {
        const level = rankingLevel(resume(0, [['Warehouse Associate', '']]), null, NOW);
        assert.equal(level.level, null);
        assert.equal(level.from, null);
        assert.match(level.detail, /can't tell your level yet/);
    });
});

describe('modelReadNeeded', () => {
    it('every complete quick read in the résumé corpus skips the model', () => {
        const dir = join(__dirname, '../fixtures/resume-corpus');
        const pasted = readdirSync(dir).filter((f) => f.endsWith('.paste.txt'));
        assert.ok(pasted.length >= 20);
        for (const file of pasted) {
            const parsed = structureResumeText(readFileSync(join(dir, file), 'utf8'));
            assert.equal(modelReadNeeded(parsed), false, file);
        }
    });

    it('a read missing skills or a job title asks the model', () => {
        const noSkills = resume(4, [['Staff Accountant', '2021 - Present']], 'Staff Accountant');
        assert.equal(modelReadNeeded(noSkills), true);
        const noTitle = { ...resume(4, []), competencies: [{ category: 'Skills', skills: ['Excel', 'SAP', 'IFRS'] }] } as ResumeData;
        assert.equal(modelReadNeeded(noTitle), true);
    });
});

describe('stopAtDeadline', () => {
    it('ends every beam once the deadline passes, and none before', () => {
        let now = 1_000;
        const step = stopAtDeadline(5_000, () => now);
        const beams = [{ done: false }, { done: false }];
        step(beams);
        assert.deepEqual(beams.map((b) => b.done), [false, false]);
        now = 5_000;
        step(beams);
        assert.deepEqual(beams.map((b) => b.done), [true, true]);
    });
});

/**
 * What a posting asks that the résumé does not show (requirement-gaps.ts), and what that does to a role:
 * a Stretch at most, whatever its title and words share with the résumé (score.ts), with the reason on
 * its receipt (explain.ts). Vivek, 2026-10-14: "most of my jobs are not relevant AT ALL", "i dont have
 * any managerial experience... should have been taken into account".
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveCandidateSignals } from '../../src/lib/jobs/candidate-signals';
import { explainMatch } from '../../src/lib/match/explain';
import { jdTermsFromDescription } from '../../src/lib/match/jd-match';
import { matchBand, scoreJobAgainstResume } from '../../src/lib/match/score';
import { COVERAGE_MIN_RESUME_TERMS, requirementGaps, REQUIREMENT_BULLETS_MIN } from '../../src/lib/match/requirement-gaps';
import { resumeTermSet } from '../../src/lib/match/jd-match';
import { deckLeftOut } from '../../src/lib/jobs/for-you/band-order';
import { resumeDataFromPlainText } from '../../src/lib/resume/structure-resume-text';
import type { PublicJob } from '../../src/lib/jobs/types';
import type { ResumeData } from '../../src/types/resume';
import { mkJob, NOW } from '../support/jobs-corpus-stub';

const TAM = resumeDataFromPlainText(readFileSync('tests/fixtures/vivek-tam-resume.txt', 'utf8'));
const withCompetency = (resume: ResumeData, skill: string): ResumeData => ({ ...resume, competencies: [...resume.competencies, { category: 'More', skills: [skill] }] });

const filler = ' We are a growing company with a friendly team and a long runway to build on.';
/** A Technical Account Manager posting for the TAM résumé, its description carrying what the test says. */
function posting(text: string, extra: Partial<PublicJob> = {}): PublicJob {
    const description = text + filler;
    const job = mkJob('x', { title: 'Technical Account Manager', experience_level: 'mid', location_country: 'Canada', work_type: 'remote', tags: [], description, ...extra });
    return { ...job, jd_terms: jdTermsFromDescription(description, job) ?? undefined };
}
const score = (resume: ResumeData, job: PublicJob) => scoreJobAgainstResume(resume, job, resolveCandidateSignals(resume, null))!;
const kinds = (resume: ResumeData, job: PublicJob) => requirementGaps(resume, job).map((g) => g.kind);
const ONBOARD = 'You will own technical onboarding for enterprise accounts.';

describe('requirementGaps', () => {
    it('finds none in a posting that asks nothing the résumé lacks', () => {
        assert.deepEqual(kinds(TAM, posting(ONBOARD)), []);
        assert.deepEqual(kinds(TAM, posting(ONBOARD, { min_years_experience: 5 })), []);
    });

    it('reads more years than the résumé shows in this line of work, with a margin for rounding up', () => {
        const gaps = requirementGaps(TAM, posting(ONBOARD, { min_years_experience: 10 }));
        assert.deepEqual(gaps.map((g) => g.kind), ['years']);
        assert.equal(gaps[0]!.text, 'it asks for 10+ years and your résumé shows 5 in this line of work');
        assert.deepEqual(kinds(TAM, posting(ONBOARD, { min_years_experience: 7 })), [], 'two years over is still within what employers round up');
    });

    it('reads the years from the posting\'s text when its structured field is missing, and the field first when it is there', () => {
        const text = 'What you bring:\n10+ years of relevant experience\nStrong communication\n' + ONBOARD;
        const gaps = requirementGaps(TAM, posting(text));
        assert.deepEqual(gaps.map((g) => g.kind), ['years']);
        assert.equal(gaps[0]!.text, 'it asks for 10+ years and your résumé shows 5 in this line of work');
        assert.deepEqual(kinds(TAM, posting('7+ years of relevant experience\n' + ONBOARD)), [], 'two years over is still within what employers round up');
        assert.deepEqual(kinds(TAM, posting('Company founded in 2001, serving clients for over 20 years. ' + ONBOARD)), []);
        assert.deepEqual(kinds(TAM, posting(text, { min_years_experience: 5 })), [], 'the structured field wins over the text');
    });

    it('reads a required language, a clearance, managing, selling and a certification the résumé does not show', () => {
        assert.deepEqual(kinds(TAM, posting('You are fluent in French and English. ' + ONBOARD)), ['language']);
        assert.deepEqual(kinds(TAM, posting('You must hold an active Secret clearance. ' + ONBOARD)), ['clearance']);
        assert.deepEqual(kinds(TAM, posting('You will have 4 direct reports. ' + ONBOARD)), ['managing']);
        assert.deepEqual(kinds(TAM, posting('You will carry a quota and prospect new logos. ' + ONBOARD)), ['selling']);
        assert.deepEqual(kinds(TAM, posting('Certification required: CISSP and Security+. ' + ONBOARD)), ['credential']);
    });

    it('finds nothing when the résumé shows it, or the posting makes it optional', () => {
        assert.deepEqual(kinds(withCompetency(TAM, 'French'), posting('You are fluent in French and English. ' + ONBOARD)), []);
        assert.deepEqual(kinds(TAM, posting('Bilingualism (English / French) is an asset. ' + ONBOARD)), []);
        assert.deepEqual(kinds(withCompetency(TAM, 'CISSP'), posting('Certification required: CISSP. ' + ONBOARD)), []);
    });

    it('reads a requirements list of which the résumé answers fewer than half, and only when the list is long enough', () => {
        const unrelated = [
            'Hands-on welding and brazing of structural steel',
            'Operating a forklift and overhead crane safely',
            'Pipefitting and boiler maintenance in plant settings',
            'Erecting scaffolding to site safety standards',
        ];
        assert.equal(unrelated.length, REQUIREMENT_BULLETS_MIN);
        const gap = posting(`${ONBOARD}\n\nRequirements\n${unrelated.map((b) => `- ${b}`).join('\n')}`);
        assert.ok(gap.jd_terms?.asks?.bullets && gap.jd_terms.asks.bullets.length >= REQUIREMENT_BULLETS_MIN, JSON.stringify(gap.jd_terms?.asks));
        assert.deepEqual(kinds(TAM, gap), ['requirements']);
        const short = posting(`${ONBOARD}\n\nRequirements\n${unrelated.slice(0, 2).map((b) => `- ${b}`).join('\n')}`);
        assert.deepEqual(kinds(TAM, short), [], 'two unanswered asks are not most of a posting');
        assert.deepEqual(kinds(TAM, posting(ONBOARD)), []);
    });
});

/** A résumé with too few lines to judge a posting's lists by: four skills and one job, as the journeys' fixture has. */
const SHORT: ResumeData = {
    ...TAM,
    experience: TAM.experience.slice(0, 1).map((role) => ({ ...role, description: 'Owned adoption, renewals and technical escalations for 40 enterprise accounts.' })),
    projects: [],
    competencies: [{ category: 'Skills', skills: ['Customer Success', 'SQL', 'REST APIs', 'Salesforce'] }],
    education: [],
    generatedSummary: 'Technical Account Manager with five years in customer success.',
};
const UNRELATED = [
    'Hands-on welding and brazing of structural steel',
    'Operating a forklift and overhead crane safely',
    'Pipefitting and boiler maintenance in plant settings',
    'Erecting scaffolding to site safety standards',
];
const unrelatedList = () => posting(`${ONBOARD}\n\nRequirements\n${UNRELATED.map((b) => `- ${b}`).join('\n')}`);

describe('a list the résumé does not answer is a ranking signal, not a reason to leave the role out', () => {
    it('marks the lists of skills and requirements soft, and every ask for something a résumé either has or lacks hard', () => {
        const soft = requirementGaps(TAM, unrelatedList());
        assert.deepEqual(soft.map((g) => [g.kind, g.soft]), [['requirements', true]]);
        const hard = requirementGaps(TAM, posting('You are fluent in French and English. ' + ONBOARD));
        assert.deepEqual(hard.map((g) => [g.kind, g.soft]), [['language', undefined]]);
    });

    it('does not judge a posting\'s lists by a résumé with too few lines to cover them', () => {
        assert.ok(resumeTermSet(SHORT).size < COVERAGE_MIN_RESUME_TERMS, String(resumeTermSet(SHORT).size));
        assert.ok(resumeTermSet(TAM).size >= COVERAGE_MIN_RESUME_TERMS, String(resumeTermSet(TAM).size));
        assert.deepEqual(kinds(SHORT, unrelatedList()), [], 'a short résumé cannot "show" a posting\'s requirement lines');
        assert.deepEqual(kinds(TAM, unrelatedList()), ['requirements']);
    });

    it('still reads a hard ask the short résumé does not show', () => {
        assert.deepEqual(kinds(SHORT, posting('You are fluent in French and English. ' + ONBOARD)), ['language']);
        assert.deepEqual(kinds(SHORT, posting('You must hold an active Secret clearance. ' + ONBOARD)), ['clearance']);
        assert.deepEqual(kinds(SHORT, posting(ONBOARD, { min_years_experience: 12 })), ['years']);
    });

    it('keeps a role it covers least in the closest-roles list, not out of it: Stretch, not a requirement', () => {
        const j = unrelatedList();
        const s = score(TAM, j);
        assert.equal(matchBand(s.total), 'stretch', String(s.total));
        assert.equal(deckLeftOut(j, s, NOW), 'stretch', 'a reason about the fit, not about something the person lacks');
        assert.equal(deckLeftOut(posting('You are fluent in French and English. ' + ONBOARD), score(TAM, posting('You are fluent in French and English. ' + ONBOARD)), NOW), 'requirement');
    });

    it('does not cap a short résumé\'s role for lists it cannot judge', () => {
        const s = score(SHORT, unrelatedList());
        assert.equal(s.gaps, undefined);
    });
});

describe('a role with a gap is a Stretch, whatever else it shares with the résumé', () => {
    it('holds each hard ask under Good, says so on the receipt, and carries the gaps on the score', () => {
        const plain = score(TAM, posting(ONBOARD));
        assert.equal(matchBand(plain.total), 'good', String(plain.total));
        assert.equal(plain.gaps, undefined);
        for (const [text, extra, phrase] of [
            ['You are fluent in French and English. ' + ONBOARD, {}, /asks for French and nothing on your résumé shows it/],
            ['You must hold an active Secret clearance. ' + ONBOARD, {}, /requires a security clearance/],
            ['You will have 4 direct reports. ' + ONBOARD, {}, /managing people, which no role on your résumé shows/],
            ['You will carry a quota and prospect new logos. ' + ONBOARD, {}, /selling job/],
            ['Certification required: CISSP and Security+. ' + ONBOARD, {}, /requires CISSP and Security\+/],
            [ONBOARD, { min_years_experience: 10 }, /asks for 10\+ years and your résumé shows 5 in this line of work/],
        ] as const) {
            const s = score(TAM, posting(text, extra));
            assert.equal(matchBand(s.total), 'stretch', `${text}: ${s.total}`);
            assert.ok(s.gaps && s.gaps.length > 0, text);
            assert.match(explainMatch(s), new RegExp(`It's a Stretch because .*${phrase.source}`), text);
        }
    });

    it('is not a Stretch once the résumé shows what it asks', () => {
        const s = score(withCompetency(TAM, 'French'), posting('You are fluent in French and English. ' + ONBOARD));
        assert.equal(s.gaps, undefined);
        assert.notEqual(matchBand(s.total), 'stretch', String(s.total));
    });
});

describe('an explicit entry title wins over a listing that read mid', () => {
    it('reads "Junior" and "Intern" as entry level for a senior résumé, so it is not at their level', () => {
        const junior = score(TAM, mkJob('j', { title: 'Junior Technical Account Manager', experience_level: 'mid', location_country: 'Canada', work_type: 'remote', tags: [] }));
        const senior = score(TAM, mkJob('s', { title: 'Technical Account Manager', experience_level: 'mid', location_country: 'Canada', work_type: 'remote', tags: [] }));
        const levelOf = (s: typeof junior) => s.components.find((c) => c.key === 'seniority')!;
        assert.ok(levelOf(junior).score < levelOf(senior).score, `${levelOf(junior).score} vs ${levelOf(senior).score}`);
    });
});

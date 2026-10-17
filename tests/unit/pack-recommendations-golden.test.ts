/**
 * The golden résumés (tests/fixtures) against what their For-you packs search
 * for and how a posting ranks: each pack must look for the roles the résumé
 * says the candidate wants, and a posting for a different kind of role must
 * never read as Strong.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveCandidateSignals } from '../../src/lib/jobs/candidate-signals';
import { packFilters } from '../../src/lib/jobs/for-you/pack-filters';
import { buildMatchQuery, roleEndYear, STALE_ROLE_YEARS, targetRoles } from '../../src/lib/jobs/resume-match';
import { MATCH_BAND_GOOD_MIN, MATCH_BAND_STRONG_MIN, roleFit, roleOffTarget, scoreJobAgainstResume } from '../../src/lib/match/score';
import { structureResumeText } from '../../src/lib/resume/structure-resume-text';
import type { PublicJob } from '../../src/lib/jobs/types';
import type { ResumeData } from '../../src/types/resume';
import { mkJob } from '../support/jobs-corpus-stub';

const NOW_YEAR = 2026;
const golden = (name: string): ResumeData =>
    structureResumeText(readFileSync(path.join(process.cwd(), `tests/fixtures/${name}.txt`), 'utf8').replace(/'/g, '’')) as ResumeData;

const PM = golden('vivek-pm-resume');
const OKTA = golden('vivek-okta-resume');
const CSM = golden('vivek-csm-golden-resume');
const SWE = golden('sample-resume');

const phrases = (resume: ResumeData) => buildMatchQuery(resume, NOW_YEAR).phrases;
const lower = (list: string[]) => list.map((p) => p.toLowerCase());

describe('what each golden résumé pack searches for', () => {
    it('the PM résumé searches product roles only, not the engineering job it left in 2018', () => {
        const searched = phrases(PM);
        assert.deepEqual(lower(searched), ['product manager', 'technical product manager', 'product owner']);
        assert.ok(searched.every((p) => !/engineer/i.test(p)), `no engineering titles: ${searched.join(', ')}`);
    });

    it('the Okta résumé searches its headline (CS Ops, TAM) and its current role (PM)', () => {
        const searched = lower(phrases(OKTA));
        for (const want of ['customer success operations manager', 'technical account manager', 'product manager']) {
            assert.ok(searched.includes(want), `${want} missing from ${searched.join(', ')}`);
        }
        assert.ok(searched.every((p) => !/engineer/.test(p)), `no engineering titles: ${searched.join(', ')}`);
    });

    it('the CSM résumé searches the CS and TAM roles its summary and skill groups name', () => {
        const searched = lower(phrases(CSM));
        assert.ok(searched.includes('customer success manager'), searched.join(', '));
        assert.ok(searched.includes('technical account manager'), searched.join(', '));
        assert.deepEqual(targetRoles(CSM).families.slice(0, 1), ['customer_success']);
    });

    it('the engineer résumé still searches engineering roles', () => {
        assert.ok(lower(phrases(SWE)).includes('software engineer'));
    });

    it('every Vivek résumé pack is Canada, senior: his 13-year career led teams before his 5 years in the role he holds now', () => {
        for (const resume of [PM, OKTA, CSM]) {
            const filters = packFilters(resume, resolveCandidateSignals(resume, null));
            assert.deepEqual(filters.facets.location_country, ['Canada']);
            assert.equal(resolveCandidateSignals(resume, null).seniority.value, 'senior');
            // Vivek, 2026-10-13: the other portals' picks were all Senior, Staff or Head of Product.
            assert.deepEqual(filters.facets.experience_level, ['mid', 'senior', 'lead']);
        }
    });
});

describe('roles that ended long ago drop out of the search', () => {
    it('reads the end year of a role', () => {
        assert.equal(roleEndYear('September ’21 — Present', NOW_YEAR), NOW_YEAR);
        assert.equal(roleEndYear('July ’19 — February ’20', NOW_YEAR), 2020);
        assert.equal(roleEndYear('February 2013 - April 2018', NOW_YEAR), 2018);
        assert.equal(roleEndYear('', NOW_YEAR), null);
    });

    it(`a role that ended ${STALE_ROLE_YEARS}+ years ago is not searched; a recent one is`, () => {
        const resume = {
            ...PM,
            profile: { ...PM.profile, profession: '' },
            experience: [
                { id: '1', role: 'Product Manager', company: 'A', dates: '2024 — Present', description: '' },
                { id: '2', role: 'Data Analyst', company: 'B', dates: '2021 — 2024', description: '' },
                { id: '3', role: 'Software Engineer', company: 'C', dates: '2013 — 2018', description: '' },
            ],
            generatedSummary: '',
            competencies: [],
        } as ResumeData;
        const searched = lower(phrases(resume));
        assert.ok(searched.includes('data analyst'), searched.join(', '));
        assert.ok(!searched.includes('software engineer'), searched.join(', '));
    });
});

describe('a posting for a different kind of role never reads as Strong', () => {
    const canada = { location_country: 'Canada', experience_level: 'senior' } as const;
    const backend = mkJob('be', { ...canada, title: 'Senior Backend Engineer', tags: ['api', 'python', 'sql', 'postgres', 'observability'] });
    const pmJob = mkJob('pm', { ...canada, title: 'Senior Product Manager', tags: ['roadmap', 'api', 'requirements', 'saas'] });
    const tpm = mkJob('tpm', { ...canada, title: 'Technical Program Manager', tags: ['agile', 'release'] });
    const csm = mkJob('csm', { ...canada, title: 'Customer Success Manager', tags: ['qbr', 'renewals', 'saas'] });
    const unknownFamily = mkJob('em', { ...canada, title: 'Engineering Manager', tags: ['api'] });

    it('for the PM résumé, the backend engineering job is off target and capped below Strong', () => {
        assert.equal(roleOffTarget(PM, backend), true);
        const score = scoreJobAgainstResume(PM, backend, resolveCandidateSignals(PM, null));
        assert.ok(score, 'shares words, so it still gets a score');
        assert.ok(score!.total < MATCH_BAND_STRONG_MIN, `backend engineer scored ${score!.total}`);
        assert.match(score!.components[0].detail, /different kind of role/);
    });

    it('for the PM résumé, product roles are on target and program roles, another family it no longer searches, are not', () => {
        assert.equal(roleOffTarget(PM, pmJob), false);
        assert.equal(roleOffTarget(PM, tpm), true, 'Program Manager names operations, not the product family the résumé names');
    });

    it('the CS résumés take Customer Success roles; the PM résumé does not', () => {
        assert.equal(roleOffTarget(OKTA, csm), false);
        assert.equal(roleOffTarget(CSM, csm), false);
        assert.equal(roleOffTarget(PM, csm), true);
    });

    it('a title that names no known family is never called off target', () => {
        assert.equal(roleOffTarget(PM, unknownFamily), false);
    });
});

/**
 * Rows the live audit of release 3 (velai.app, 2026-09-29) flagged. List rows are
 * scored on title and tags only, so each one read Good on the pack card.
 */
describe('the rows the live pack audit flagged', () => {
    const posting = (title: string, extra: Partial<PublicJob> = {}) =>
        mkJob(title, { title, experience_level: 'senior', location_country: 'Canada', ...extra });
    const band = (resume: ResumeData, title: string, extra: Partial<PublicJob> = {}) =>
        scoreJobAgainstResume(resume, posting(title, extra), resolveCandidateSignals(resume, null));

    it('an SRE posting is a Stretch at most for the PM, Okta and CSM résumés', () => {
        for (const resume of [PM, OKTA, CSM]) {
            assert.equal(roleFit(resume, posting('Software Engineer, SRE')), 'off-target');
            const score = band(resume, 'Software Engineer, SRE', { tags: ['product', 'api', 'incident'] });
            if (score) assert.ok(score.total < MATCH_BAND_GOOD_MIN, `SRE scored ${score.total}`);
        }
    });

    it('an Account Executive posting is a Stretch at most for the CS résumés', () => {
        for (const resume of [OKTA, CSM]) {
            assert.equal(roleFit(resume, posting('Account Executive (DACH)')), 'off-target');
            const score = band(resume, 'Account Executive (DACH)', { tags: ['customer', 'saas'] });
            if (score) assert.ok(score.total < MATCH_BAND_GOOD_MIN, `Account Executive scored ${score.total}`);
        }
    });

    it('a title tied to no target role is never Strong, however many words it shares', () => {
        assert.equal(roleFit(PM, posting('Health And Safety Manager F H')), 'unverified');
        const score = band(PM, 'Health And Safety Manager F H', { tags: ['health', 'manager'] });
        assert.ok(score, 'shares words, so it gets a score');
        assert.ok(score!.total < MATCH_BAND_STRONG_MIN, `Health and Safety Manager scored ${score!.total}`);
    });

    it('the roles each pack searches for are on target', () => {
        assert.equal(roleFit(PM, posting('Senior Product Manager, Payments')), 'target');
        assert.equal(roleFit(OKTA, posting('Customer Success Operations Manager')), 'target');
        assert.equal(roleFit(CSM, posting('Technical Account Manager II')), 'target');
    });
});

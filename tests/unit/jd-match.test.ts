/**
 * Résumé ↔ job-description match (src/lib/match/jd-match.ts) and how the fit
 * score uses it (review 2026-10-13: fit used to read the title and tags only).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
    jdCoverage,
    jdFitScore,
    jdFullCoverageFor,
    jdTermsFromDescription,
    jdTermsOf,
    JD_FULL_COVERAGE,
    JD_FULL_RESUME_TERMS,
    resumeTermSet,
} from '../../src/lib/match/jd-match';
import { scoreJobAgainstResume } from '../../src/lib/match/score';
import { structureResumeText } from '../../src/lib/resume/structure-resume-text';
import type { ResumeData } from '../../src/types/resume';
import { mkJob } from '../support/jobs-corpus-stub';

const golden = (name: string): ResumeData =>
    structureResumeText(readFileSync(path.join(process.cwd(), `tests/fixtures/${name}.txt`), 'utf8').replace(/'/g, '’')) as ResumeData;

const DATA_PM = `About Northwind
Northwind builds payroll software for 4,000 companies. We are an equal opportunity employer.

Responsibilities
- Own the product roadmap for our billing platform and payments APIs
- Run customer discovery interviews and A/B tests; define success metrics with SQL
- Partner with engineering on sprint planning in Jira

Requirements
- 4+ years of product management experience in B2B SaaS
- Hands-on SQL and data analysis; experience with A/B testing
- Experience shipping APIs and billing or payments products

Benefits
- Dental, vision, RRSP matching and flexible hours`;

const NURSE = `Responsibilities
- Provide direct patient care in the intensive care unit
- Administer medications and monitor vital signs; document in Epic

Qualifications
- Current registration with the College of Nurses of Ontario
- BLS and ACLS certification; 2+ years of critical care nursing`;

const PM = golden('vivek-pm-resume');
const RN = golden('health-rn-resume');

describe('jdTermsFromDescription', () => {
    it('reads requirements and duties apart, and keeps their phrases', () => {
        const terms = jdTermsFromDescription(DATA_PM, { company: 'Northwind', location: 'Toronto, ON' })!;
        assert.ok(terms.req.includes('sql'), terms.req.join(' · '));
        assert.ok(terms.req.includes('product management'), terms.req.join(' · '));
        assert.ok(terms.duty.includes('product roadmap'), terms.duty.join(' · '));
        assert.ok(terms.duty.includes('customer discovery'), terms.duty.join(' · '));
    });

    it('leaves out boilerplate, benefits, the employer\'s own name and contractions', () => {
        const terms = jdTermsFromDescription(DATA_PM, { company: 'Northwind', location: 'Toronto, ON' })!;
        const all = [...terms.req, ...terms.duty];
        for (const junk of ['experience', 'years', 'northwind', 'dental', 'rrsp', 'equal opportunity', "we're"]) {
            assert.ok(!all.some((t) => t.split(' ').includes(junk) || t === junk), `${junk} leaked: ${all.join(' · ')}`);
        }
    });

    it('a posting with no headings still yields its terms, as duties', () => {
        const terms = jdTermsFromDescription('We need a forklift operator for our warehouse. Forklift certification and warehouse inventory experience required.')!;
        assert.deepEqual(terms.req, []);
        assert.ok(terms.duty.includes('forklift'));
    });

    it('nothing to read → null', () => {
        assert.equal(jdTermsFromDescription(''), null);
        assert.equal(jdTermsFromDescription(null), null);
    });
});

describe('jdCoverage — how much of what the posting asks shows on the résumé', () => {
    it('a product posting covers more of a PM résumé than a nursing one does, and the reverse', () => {
        const pmTerms = jdTermsFromDescription(DATA_PM)!;
        const rnTerms = jdTermsFromDescription(NURSE)!;
        assert.ok(jdCoverage(PM, pmTerms)!.coverage > jdCoverage(PM, rnTerms)!.coverage);
        assert.ok(jdCoverage(RN, rnTerms)!.coverage > jdCoverage(RN, pmTerms)!.coverage);
    });

    it('names the matched and missing terms, requirements first', () => {
        const c = jdCoverage(PM, jdTermsFromDescription(DATA_PM)!)!;
        assert.ok(c.matched.length > 0 && c.missing.length > 0);
        assert.ok(c.matched.includes('sql'), c.matched.join(' · '));
    });

    it('evidenced must-have skills lead the requirements; unstamped (possibly fabricated) ones are ignored', () => {
        const evidenced = jdTermsFromDescription(NURSE, { must_have_skills: ['SQL'], skills_section_found: true })!;
        const unstamped = jdTermsFromDescription(NURSE, { must_have_skills: ['SQL'] })!;
        assert.equal(evidenced.req[0], 'sql');
        assert.ok(!unstamped.req.includes('sql'));
        assert.ok(jdCoverage(PM, evidenced)!.coverage > jdCoverage(PM, unstamped)!.coverage);
    });
});

describe('jdFitScore — calibrated to the résumé\'s size', () => {
    it('a full résumé needs JD_FULL_COVERAGE for a full score', () => {
        assert.equal(jdFullCoverageFor(JD_FULL_RESUME_TERMS), JD_FULL_COVERAGE);
        assert.equal(jdFitScore(JD_FULL_COVERAGE, JD_FULL_RESUME_TERMS), 1);
        assert.equal(jdFitScore(0, JD_FULL_RESUME_TERMS), 0);
    });

    it('a short résumé reaches a full score on less coverage, never on none', () => {
        assert.ok(jdFullCoverageFor(60) < jdFullCoverageFor(500));
        assert.ok(jdFitScore(0.08, 60) > jdFitScore(0.08, 600));
        assert.equal(jdFitScore(0, 60), 0);
        assert.ok(resumeTermSet(RN).size < JD_FULL_RESUME_TERMS);
    });
});

describe('the fit score reads the whole posting', () => {
    const job = (description: string) =>
        mkJob('j', { title: 'Product Manager', company: 'Northwind', location_country: 'Canada', experience_level: 'mid', description });

    it('two "Product Manager" postings no longer score the same: the one whose asks you meet scores higher', () => {
        const fits = scoreJobAgainstResume(PM, job(DATA_PM))!;
        const other = scoreJobAgainstResume(PM, job(NURSE.replace('Responsibilities', 'Responsibilities\n- Lead product for our clinical charting tools')))!;
        assert.ok(fits.components[0].score > other.components[0].score, `${fits.components[0].score} vs ${other.components[0].score}`);
        assert.ok(fits.components[0].jd, 'the relevance row carries the description match');
        assert.match(fits.components[0].detail, /of what it asks shows on your résumé/);
    });

    it('a row without a description scores on its title and tags, as before', () => {
        const row = scoreJobAgainstResume(PM, mkJob('r', { title: 'Product Manager', location_country: 'Canada' }))!;
        assert.equal(row.components[0].jd, undefined);
    });

    it('the terms a server attached to a row score the same as the page\'s own description', () => {
        const page = job(DATA_PM);
        const row = { ...page, description: null, jd_terms: jdTermsFromDescription(DATA_PM, page) };
        assert.equal(scoreJobAgainstResume(PM, row)!.total, scoreJobAgainstResume(PM, page)!.total);
    });

    it('jdTermsOf prefers the row\'s terms and reads a description once', () => {
        const page = job(DATA_PM);
        assert.equal(jdTermsOf(page), jdTermsOf(page));
        const terms = { req: ['x'], duty: [] };
        assert.equal(jdTermsOf({ ...page, jd_terms: terms }), terms);
    });
});

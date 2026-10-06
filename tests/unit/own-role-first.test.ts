/**
 * Vivek's Technical Account Manager résumé (tests/fixtures/vivek-tam-resume.txt,
 * the text the site stores for his PDF upload) against how its list is built and
 * ordered. Reported 2026-09-30: "I don't even see a single TAM role in my list".
 * Every searched title scored full relevance (its words all appear somewhere in
 * the résumé), so senior Product Manager postings tied with TAM postings and won
 * on level. The candidate's own role now ranks first, and a neighbouring role
 * can't read Strong.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveCandidateSignals } from '../../src/lib/jobs/candidate-signals';
import { orderForYouJobsByBand } from '../../src/lib/jobs/for-you/band-order';
import { rankForYou } from '../../src/lib/jobs/for-you/ranked';
import { buildMatchQuery, targetRoles } from '../../src/lib/jobs/resume-match';
import { titlePlace } from '../../src/lib/jobs/resume-location';
import { explainMatch } from '../../src/lib/match/explain';
import {
    compareFit,
    MATCH_BAND_GOOD_MIN,
    MATCH_BAND_STRONG_MIN,
    matchBand,
    roleAffinity,
    scoreJobAgainstResume,
    type MatchScore,
} from '../../src/lib/match/score';
import { resumeDataFromPlainText, structureResumeText } from '../../src/lib/resume/structure-resume-text';
import type { JobSearchResult, PublicJob } from '../../src/lib/jobs/types';
import type { ResumeData } from '../../src/types/resume';
import { mkJob } from '../support/jobs-corpus-stub';

const NOW_YEAR = 2026;
const fixture = (name: string) => readFileSync(path.join(process.cwd(), `tests/fixtures/${name}.txt`), 'utf8');
const golden = (name: string): ResumeData => structureResumeText(fixture(name).replace(/'/g, '’')) as ResumeData;

/** Structured the way the site structures an uploaded file (stored-resume-data.ts). */
const TAM = resumeDataFromPlainText(fixture('vivek-tam-resume'));
const PM = golden('vivek-pm-resume');
const CSM = golden('vivek-csm-golden-resume');
// The sample résumé gives no location, which alone caps a score below Strong.
const SWE: ResumeData = (() => { const r = golden('sample-resume'); return { ...r, profile: { ...r.profile, location: 'Toronto, Ontario' } }; })();

const canada = (title: string, experience_level: string, extra: Partial<PublicJob> = {}) =>
    mkJob(title, { title, experience_level, location_country: 'Canada', tags: [], ...extra });
const score = (resume: ResumeData, job: PublicJob) => scoreJobAgainstResume(resume, job, resolveCandidateSignals(resume, null));

describe('what the TAM résumé searches for', () => {
    it('reads the upload as a Technical Account Manager in Canada', () => {
        assert.equal(TAM.profile.profession, 'Technical Account Manager');
        assert.equal(TAM.experience[0]?.role, 'Technical Account Manager');
        assert.deepEqual(resolveCandidateSignals(TAM, null).location.value?.countries, ['Canada']);
    });

    it('searches its own title first, then customer success, then product (the order its summary names them)', () => {
        assert.deepEqual(
            buildMatchQuery(TAM, NOW_YEAR).phrases.map((p) => p.toLowerCase()),
            ['technical account manager', 'customer success manager', 'product manager', 'technical product manager'],
        );
        assert.deepEqual(targetRoles(TAM).families, ['customer_success', 'product']);
    });

    it('its own role is the TAM title alone: "client-facing product owner" describes the job, not a second target', () => {
        assert.deepEqual(targetRoles(TAM).own, ['Technical Account Manager']);
        assert.deepEqual(targetRoles(TAM).ownFamilies, ['customer_success']);
    });

    it('the CSM résumé counts the customer success title its summary opens with as its own', () => {
        assert.ok(targetRoles(CSM).own.includes('Customer Success'), targetRoles(CSM).own.join(', '));
    });
});

describe('how close a posting is to the candidate\'s own role', () => {
    it('grades TAM postings own, CS postings family, PM postings adjacent, engineering off target', () => {
        assert.equal(roleAffinity(TAM, canada('Sr. Technical Account Manager, Enterprise', 'senior')), 'own');
        assert.equal(roleAffinity(TAM, canada('Technical Account Manager II', 'unknown')), 'own');
        assert.equal(roleAffinity(TAM, canada('Customer Success Manager', 'mid')), 'family');
        assert.equal(roleAffinity(TAM, canada('Senior Product Manager', 'senior')), 'adjacent');
        assert.equal(roleAffinity(TAM, canada('Software Engineer, SRE', 'senior')), 'off-target');
    });

    it('a neighbouring role is Good at best; the own role can be Strong', () => {
        const pm = score(TAM, canada('Senior Product Manager', 'senior'))!;
        assert.ok(pm.total < MATCH_BAND_STRONG_MIN, `Senior PM scored ${pm.total}`);
        assert.ok(pm.total >= MATCH_BAND_GOOD_MIN, `Senior PM scored ${pm.total}`);
        const tam = score(TAM, canada('Technical Account Manager', 'mid'))!;
        assert.ok(tam.total >= MATCH_BAND_STRONG_MIN, `TAM scored ${tam.total}`);
        assert.equal(tam.role, 'own');
        assert.equal(tam.yourRole, 'Technical Account Manager');
    });

    it('the same kind of role under another title can still be Strong (a backend role for a software engineer)', () => {
        const backend = score(SWE, canada('Senior Backend Engineer', 'senior', { tags: ['typescript'] }))!;
        assert.equal(backend.role, 'family');
        assert.ok(backend.total >= MATCH_BAND_STRONG_MIN, `backend scored ${backend.total}`);
    });

    it('a PM résumé keeps its product roles Strong and a Program Manager role Good', () => {
        assert.equal(roleAffinity(PM, canada('Technical Product Manager', 'senior')), 'own');
        const program = score(PM, canada('Program Manager', 'senior'))!;
        assert.equal(program.role, 'adjacent');
        assert.ok(program.total < MATCH_BAND_STRONG_MIN);
    });
});

describe('the TAM list puts TAM roles first', () => {
    // The shape of Vivek's screenshot: senior PM postings, then TAM postings.
    const listed = [
        canada('Senior Product Manager, Accounts, Billing, & Compliance', 'senior'),
        canada('Sr. Product Manager - Video Devices', 'senior'),
        canada('Staff Product Manager (Measurement)', 'senior'),
        canada('Customer Success Manager', 'mid'),
        canada('Technical Account Manager', 'unknown'),
        canada('Technical Account Manager', 'mid', { id: 'tam-mid' }),
        canada('Senior Technical Account Manager', 'senior'),
    ];
    const scores = new Map<string, MatchScore | null>(listed.map((job) => [job.id, score(TAM, job)]));
    const q = buildMatchQuery(TAM, NOW_YEAR).q;

    it('the deck (tier, then band) lists every TAM posting before the CSM and PM postings', () => {
        const ordered = orderForYouJobsByBand(listed, (job) => scores.get(job.id) ?? null, q).map((job) => job.title);
        assert.deepEqual(ordered.slice(0, 3).map((t) => /technical account manager/i.test(t)), [true, true, true], ordered.join(' | '));
        assert.equal(ordered[3], 'Customer Success Manager', ordered.join(' | '));
        assert.ok(ordered.slice(4).every((t) => /product manager/i.test(t)), ordered.join(' | '));
    });

    it('Search ranked by résumé (compareFit) does the same', () => {
        const ordered = [...listed].sort((a, b) => compareFit(scores.get(a.id), scores.get(b.id))).map((job) => job.title);
        assert.ok(ordered.slice(0, 3).every((t) => /technical account manager/i.test(t)), ordered.join(' | '));
    });

    it('the for_you tool (rankForYou) does the same', async () => {
        const search = async (): Promise<JobSearchResult> => ({ hits: listed, total: listed.length, backend: 'meilisearch', configured: true, effectiveQ: q });
        const ranked = await rankForYou({ resume: TAM, search, candidateDepth: 50, signals: resolveCandidateSignals(TAM, null) });
        const titles = ranked.hits.map((hit) => hit.job.title);
        assert.ok(titles.slice(0, 3).every((t) => /technical account manager/i.test(t)), titles.join(' | '));
    });

    it('no PM posting reads Strong for the TAM résumé any more', () => {
        for (const job of listed.filter((j) => /product manager/i.test(j.title))) {
            assert.notEqual(matchBand(scores.get(job.id)!.total), 'strong', job.title);
        }
    });
});

describe('a remote posting that names its region in the title', () => {
    it('reads the region or country after the role', () => {
        assert.equal(titlePlace('Technical Account Manager - Europe')?.label, 'Europe');
        assert.ok(titlePlace('Technical Account Manager - Europe')!.countries.includes('Germany'));
        assert.equal(titlePlace('TAM (DACH)')?.label, 'DACH');
        assert.deepEqual(titlePlace('Account Manager, UK')?.countries, ['United Kingdom']);
        assert.ok(titlePlace('Technical Account Manager - North America')!.countries.includes('Canada'));
    });

    it('never reads the role itself or a product area as a place', () => {
        assert.equal(titlePlace('Sr. Product Manager - Video Devices'), null);
        assert.equal(titlePlace('Senior Product Manager, Accounts, Billing, & Compliance'), null);
        assert.equal(titlePlace('Technical Account Manager'), null);
    });

    it('a Europe-only TAM role is not Strong for a Toronto résumé', () => {
        const europe = score(TAM, mkJob('eu', { title: 'Technical Account Manager - Europe', experience_level: 'senior', work_type: 'remote', location_country: null, tags: [] }))!;
        assert.ok(europe.total < MATCH_BAND_STRONG_MIN, `Europe TAM scored ${europe.total}`);
        assert.match(europe.components[2].detail, /Europe/);
    });
});

describe('the plain-English reason behind the label', () => {
    it('says a TAM posting is the candidate\'s own role, and why an unlabelled one is only Good', () => {
        const unknownLevel = score(TAM, canada('Technical Account Manager II', 'unknown'))!;
        const text = explainMatch(unknownLevel);
        assert.match(text, /your own role: the title matches Technical Account Manager/);
        assert.match(text, /isn't a Strong match because the posting doesn't say what level it is/);
    });

    it('says a PM posting is next to the TAM role, not the same job', () => {
        const text = explainMatch(score(TAM, canada('Product Manager', 'mid'))!);
        assert.match(text, /role next to yours \(Technical Account Manager\)/);
        assert.match(text, /its level fits your experience/i);
    });

    it('names the region a remote role is based in', () => {
        const text = explainMatch(score(TAM, mkJob('eu', { title: 'Technical Account Manager - Europe', experience_level: 'senior', work_type: 'remote', location_country: null, tags: [] }))!);
        assert.match(text, /remote but based in Europe/);
    });

    it('says an off-target role is a Stretch at most', () => {
        const text = explainMatch(score(PM, canada('Software Engineer, SRE', 'senior', { tags: ['api'] }))!);
        assert.match(text, /different kind of role from your Product Manager work/);
    });

    it('reads without a role when the score carries none', () => {
        const text = explainMatch({ total: 85, components: [{ key: 'seniority', label: 'Seniority', detail: 'senior — fits', score: 1, reason: 'level_fits' }] });
        assert.equal(text, 'Its level fits your experience.');
    });
});

describe('the whole résumé decides which of its roles leads', () => {
    // Vivek's CSM résumé: current job "Client-facing Product Manager", but the summary opens
    // "Senior Customer Success and Technical Account Manager" and the first skill group is
    // "Customer Success & Account Management". Its list was every Product Manager posting first.
    const listed = [
        canada('Senior Product Manager', 'senior'),
        canada('Product Manager, Growth', 'senior'),
        canada('Technical Product Manager', 'senior'),
        canada('Senior Customer Success Manager', 'senior'),
        canada('Technical Account Manager', 'senior'),
    ];
    const order = (resume: ResumeData, jobs: PublicJob[]) => {
        const scores = new Map(jobs.map((job) => [job.id, score(resume, job)]));
        return orderForYouJobsByBand(jobs, (job) => scores.get(job.id) ?? null, buildMatchQuery(resume, NOW_YEAR).q).map((job) => job.title);
    };

    it('a résumé whose summary and skills lead with customer success lists those roles before its Product Manager ones', () => {
        const ordered = order(CSM, listed);
        assert.deepEqual(ordered.slice(0, 2), ['Senior Customer Success Manager', 'Technical Account Manager'], ordered.join(' | '));
        assert.ok(ordered.slice(2).every((t) => /product manager/i.test(t)), ordered.join(' | '));
    });

    it('its Product Manager postings are still its own role and can still read Strong', () => {
        const pm = score(CSM, canada('Senior Product Manager', 'senior'))!;
        assert.equal(pm.role, 'own');
        assert.equal(matchBand(pm.total), 'strong');
    });

    it('skill groups alone never put another kind of role ahead of the candidate\'s own title', () => {
        // A barista whose skill group says "Customer Service": barista postings stay first.
        const barista = {
            profile: { name: 'Test Person', profession: 'Barista', yearsOfExperience: 3, location: 'Toronto, ON, Canada', email: 't@example.com', phone: '', linkedin: '', website: '' },
            experience: [{ id: 'e1', company: 'Cafe', role: 'Barista', dates: '2022 - Present', description: 'Made drinks and served customers.' }],
            competencies: [{ category: 'Customer Service', skills: ['Customer success', 'Cash handling'] }],
            education: [],
            generatedSummary: '',
        } as unknown as ResumeData;
        const ordered = order(barista, [canada('Customer Success Manager', 'mid'), canada('Barista', 'mid')]);
        assert.equal(ordered[0], 'Barista', ordered.join(' | '));
    });

    it('a PM résumé that names no other kind of role keeps its order', () => {
        const ordered = order(PM, listed);
        assert.ok(ordered.slice(0, 3).every((t) => /product manager/i.test(t)), ordered.join(' | '));
    });

    it('works outside tech: a nurse now managing clinic operations, whose summary leads with nursing, sees nursing roles first', () => {
        const nurse = {
            profile: { name: 'Test Person', profession: 'Clinic Operations Manager', yearsOfExperience: 4, location: 'Toronto, ON, Canada', email: 't@example.com', phone: '', linkedin: '', website: '' },
            experience: [{ id: 'e1', company: 'Clinic Group', role: 'Clinic Operations Manager', dates: '2023 - Present', description: 'Scheduled clinic staff and patient intake.' }],
            competencies: [{ category: 'Patient Care', skills: ['Medication administration', 'Patient assessment'] }],
            education: [{ id: 'ed1', degree: 'BScN', institution: 'State University', year: '2020' }],
            generatedSummary: 'Registered Nurse with 4 years of acute care and clinic operations experience.',
        } as unknown as ResumeData;
        const ordered = order(nurse, [canada('Operations Manager', 'mid'), canada('Registered Nurse', 'mid'), canada('Clinic Operations Manager', 'mid'), canada('Registered Nurse, Day Surgery', 'mid')]);
        assert.deepEqual(ordered.slice(0, 2).map((t) => /nurse/i.test(t)), [true, true], ordered.join(' | '));
    });
});

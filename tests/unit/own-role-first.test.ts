/**
 * Vivek's Technical Account Manager résumé (tests/fixtures/vivek-tam-resume.txt,
 * the text the site stores for his PDF upload) against how its list is built and
 * ordered. Reported 2026-09-30: "I don't even see a single TAM role in my list".
 * Every searched title scored full relevance (its words all appear somewhere in
 * the résumé), so senior Product Manager postings tied with TAM postings and won
 * on level. The candidate's own role now ranks first, and a neighbouring role
 * can't read Strong.
 */
import { after, before, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveCandidateSignals } from '../../src/lib/jobs/candidate-signals';
import { compareForYouKeys, forYouSortKey, orderForYouJobsByBand } from '../../src/lib/jobs/for-you/band-order';
import { rankForYou } from '../../src/lib/jobs/for-you/ranked';
import { todayLeftOut } from '../../src/lib/jobs/for-you/today';
import { resumeSearchMark } from '../../src/lib/jobs/search-payload';
import { buildMatchQuery, targetRoles } from '../../src/lib/jobs/resume-match';
import { titlePlace } from '../../src/lib/jobs/resume-location';
import { explainMatch } from '../../src/lib/match/explain';
import {
    compareFit,
    MATCH_BAND_GOOD_MIN,
    MATCH_BAND_STRONG_MIN,
    matchBand,
    outsideLevel,
    pastSeniorRole,
    roleAffinity,
    scoreJobAgainstResume,
    type MatchScore,
} from '../../src/lib/match/score';
import { resumeDataFromPlainText, structureResumeText } from '../../src/lib/resume/structure-resume-text';
import type { JobSearchResult, PublicJob } from '../../src/lib/jobs/types';
import type { ResumeData } from '../../src/types/resume';
import { corpusStub, mkJob, NOW } from '../support/jobs-corpus-stub';

// The fixtures are dated from the stub's clock; read them against it, not today's, so they do not age past the 30 days a For you list keeps.
before(() => mock.timers.enable({ apis: ['Date'], now: NOW }));
after(() => mock.timers.reset());

const NOW_YEAR = 2026;
const fixture = (name: string) => readFileSync(path.join(process.cwd(), `tests/fixtures/${name}.txt`), 'utf8');
const golden = (name: string): ResumeData => structureResumeText(fixture(name).replace(/'/g, '’')) as ResumeData;

/** Structured the way the site structures an uploaded file (stored-resume-data.ts). */
const TAM = resumeDataFromPlainText(fixture('vivek-tam-resume'));
const PM = golden('vivek-pm-resume');
/**
 * The same TAM career without its lead and senior titles (Team Lead, Senior Software Engineer…): its
 * 5 years as a TAM read mid. The real one reads senior (senior-aware fit, 2026-10-13: total years plus
 * lead roles carry the level up one step), so the above-level rules are shown on this one.
 */
const TAM_MID: ResumeData = { ...TAM, experience: TAM.experience.map((e, i) => (i === 0 ? e : { ...e, role: 'Software Engineer' })) };
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

    it('searches its own title first, then customer success, and not the product roles its summary also names', () => {
        // Titles the search adds stay in the résumé's own line of work (focus group, 2026-10-12: a CSM's search added "Product Manager").
        assert.deepEqual(
            buildMatchQuery(TAM, NOW_YEAR).phrases.map((p) => p.toLowerCase()),
            ['technical account manager', 'customer success manager'],
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
        const pm = score(TAM_MID, canada('Product Manager', 'mid'))!;
        assert.ok(pm.total < MATCH_BAND_STRONG_MIN, `PM scored ${pm.total}`);
        assert.ok(pm.total >= MATCH_BAND_GOOD_MIN, `PM scored ${pm.total}`);
        // Above the TAM's mid level as well: a Stretch.
        assert.ok(score(TAM_MID, canada('Senior Product Manager', 'senior'))!.total < MATCH_BAND_GOOD_MIN);
        const tam = score(TAM_MID, canada('Technical Account Manager', 'mid'))!;
        assert.ok(tam.total >= MATCH_BAND_STRONG_MIN, `TAM scored ${tam.total}`);
        assert.equal(tam.role, 'own');
        assert.equal(tam.yourRole, 'Technical Account Manager');
    });

    it('the same kind of role under another title can still be Strong (a backend role for a software engineer)', () => {
        const backend = score(SWE, canada('Senior Backend Engineer', 'senior', { tags: ['typescript'] }))!;
        assert.equal(backend.role, 'family');
        assert.ok(backend.total >= MATCH_BAND_STRONG_MIN, `backend scored ${backend.total}`);
    });

    it('a PM résumé keeps its product roles Strong; a Program Manager role, another kind of job it no longer searches, is a Stretch', () => {
        assert.equal(roleAffinity(PM, canada('Technical Product Manager', 'senior')), 'own');
        const program = score(PM, canada('Program Manager', 'senior'))!;
        assert.equal(program.role, 'off-target');
        assert.equal(matchBand(program.total), 'stretch');
        assert.match(explainMatch(program), /It's a different kind of role from your .* work/);
    });
});

describe('senior-aware fit for the real TAM career (11 years, lead and senior roles before 5 as a TAM)', () => {
    it('reads senior, fits mid and senior TAM roles alike as Strong, and says why', () => {
        const mid = score(TAM, canada('Technical Account Manager', 'mid'))!;
        const senior = score(TAM, canada('Senior Technical Account Manager', 'senior'))!;
        assert.equal(matchBand(mid.total), 'strong');
        assert.equal(matchBand(senior.total), 'strong');
        assert.match(explainMatch(mid), /it's a mid-level role, which fits your experience: 11 years, including lead and senior roles/);
        assert.match(explainMatch(senior), /it's a senior role, which matches the senior level of your 11 years of experience/);
    });
    it('a Senior PM role next to the TAM role is Good at most, never ahead of the TAM roles', () => {
        const pm = score(TAM, canada('Senior Product Manager', 'senior'))!;
        assert.equal(matchBand(pm.total), 'good');
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

    it('the deck lists every TAM posting before the CSM and PM postings', () => {
        const ordered = orderForYouJobsByBand(listed, (job) => scores.get(job.id) ?? null, NOW).map((job) => job.title);
        assert.deepEqual(ordered.slice(0, 3).map((t) => /technical account manager/i.test(t)), [true, true, true], ordered.join(' | '));
        assert.ok(!ordered.some((t) => /staff/i.test(t)), 'the Staff role (past this résumé\'s level) is the one left out');
        assert.equal(ordered.length, listed.length - 1, ordered.join(' | '));
    });

    it('Search ranked by résumé (compareFit) does the same', () => {
        const ordered = [...listed].sort((a, b) => compareFit(scores.get(a.id), scores.get(b.id))).map((job) => job.title);
        assert.ok(ordered.slice(0, 3).every((t) => /technical account manager/i.test(t)), ordered.join(' | '));
    });

    it('the for_you tool (rankForYou) does the same', async () => {
        const search = async (): Promise<JobSearchResult> => ({ hits: listed, total: listed.length, backend: 'meilisearch', configured: true, effectiveQ: q });
        const ranked = await rankForYou({ resume: TAM, search, candidateDepth: 50, signals: resolveCandidateSignals(TAM, null) });
        const titles = ranked.hits.map((hit) => hit.job.title);
        // Senior-aware fit (2026-10-13): read senior, the résumé's own line still leads — every TAM role, the Senior
        // TAM included, comes first. A title the résumé does not name is kept when the posting fits (content decides,
        // the title only orders), so the customer success role and the two Product Manager postings listed Senior
        // follow; the Staff one is past Senior.
        assert.ok(titles.slice(0, 3).every((t) => /technical account manager/i.test(t)), titles.join(' | '));
        assert.ok(titles.slice(3).includes('Customer Success Manager'), titles.join(' | '));
        assert.equal(titles.length, 6, titles.join(' | '));
        assert.equal(ranked.leftOut.considered, listed.length);
        assert.equal(ranked.leftOut.byReason['other-role'] ?? 0, 0, 'no posting here is another kind of job');
        assert.equal(ranked.leftOut.byReason.level, 1, 'the Staff Product Manager is past Senior');
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
        const unknownLevel = score(TAM_MID, canada('Technical Account Manager II', 'unknown'))!;
        const text = explainMatch(unknownLevel);
        assert.match(text, /your own role: the title matches Technical Account Manager/);
        assert.match(text, /isn't a Strong match because the posting doesn't say what level it is/);
    });

    it('says a PM posting is next to the TAM role, not the same job', () => {
        const text = explainMatch(score(TAM_MID, canada('Product Manager', 'mid'))!);
        assert.match(text, /role next to yours \(Technical Account Manager\)/);
        // The level says what it was read from: 5 years as a TAM, not the whole 13-year career.
        assert.match(text, /it's a mid-level role, which matches the mid level of your 5 years as a Technical Account Manager/i);
    });

    it('names the region a remote role is based in', () => {
        const text = explainMatch(score(TAM_MID, mkJob('eu', { title: 'Technical Account Manager - Europe', experience_level: 'senior', work_type: 'remote', location_country: null, tags: [] }))!);
        assert.match(text, /remote but based in Europe/);
    });

    it('says when a role is above their level, and what each level was read from; such a role is a Stretch', () => {
        const listed = score(TAM_MID, canada('Senior Technical Account Manager', 'senior'))!;
        assert.match(explainMatch(listed), /It's a Stretch because it's a senior role, above the mid level of your 5 years as a Technical Account Manager/);
        assert.equal(matchBand(listed.total), 'stretch');
        const titled = score(TAM_MID, canada('Senior Technical Account Manager, Enterprise', 'unknown'))!;
        assert.match(explainMatch(titled), /its title makes it a senior role, above the mid level of your 5 years as a Technical Account Manager/i);
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
        return orderForYouJobsByBand(jobs, (job) => scores.get(job.id) ?? null, NOW).map((job) => job.title);
    };

    it('a résumé whose summary and skills lead with customer success lists those roles before its Product Manager ones', () => {
        // All five postings are its own kind of role and fit equally (a list row has no text to tell them apart), so what separates
        // them is the kind of work the résumé leads with: customer success (headline, summary, first skill group) before the title of
        // its current job. Whichever way the search returned them.
        const scored = listed.map((job) => score(CSM, job)!);
        assert.deepEqual(scored.map((s) => s.role), ['own', 'own', 'own', 'own', 'own']);
        assert.equal(new Set(scored.map((s) => s.total)).size, 1, 'the five fit exactly alike, so only the leading family can order them');
        for (const jobs of [listed, [...listed].reverse()]) {
            const ordered = order(CSM, jobs);
            assert.deepEqual([...ordered.slice(0, 2)].sort(), ['Senior Customer Success Manager', 'Technical Account Manager'], ordered.join(' | '));
            assert.ok(ordered.slice(2).every((t) => /product manager/i.test(t)), ordered.join(' | '));
        }
    });

    it('the leading family breaks a tie in fit and never moves a role past a better-fitting one', () => {
        const cs = score(CSM, canada('Senior Customer Success Manager', 'senior'))!;
        const pm = score(CSM, canada('Senior Product Manager', 'senior'))!;
        assert.ok((cs.familyRank ?? 0) < (pm.familyRank ?? 0), `${cs.familyRank} vs ${pm.familyRank}`);
        // Equal fit: the leading family first.
        assert.ok(compareForYouKeys(forYouSortKey(cs, NOW, NOW), forYouSortKey(pm, NOW, NOW)) < 0);
        // A Product Manager role that fits better still leads.
        const better = { ...pm, total: pm.total + 10 } as MatchScore;
        assert.ok(compareForYouKeys(forYouSortKey(better, NOW, NOW), forYouSortKey(cs, NOW, NOW)) < 0);
    });

    it('its Product Manager postings are still its own role and can still read Strong', () => {
        const pm = score(CSM, canada('Product Manager', 'mid'))!;
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

    it('works outside tech: a nurse now managing clinic operations, whose summary leads with nursing, sees a nursing role first and both listed', () => {
        const nurse = {
            profile: { name: 'Test Person', profession: 'Clinic Operations Manager', yearsOfExperience: 4, location: 'Toronto, ON, Canada', email: 't@example.com', phone: '', linkedin: '', website: '' },
            experience: [{ id: 'e1', company: 'Clinic Group', role: 'Clinic Operations Manager', dates: '2023 - Present', description: 'Scheduled clinic staff and patient intake.' }],
            competencies: [{ category: 'Patient Care', skills: ['Medication administration', 'Patient assessment'] }],
            education: [{ id: 'ed1', degree: 'BScN', institution: 'State University', year: '2020' }],
            generatedSummary: 'Registered Nurse with 4 years of acute care and clinic operations experience.',
        } as unknown as ResumeData;
        const ordered = order(nurse, [canada('Operations Manager', 'mid'), canada('Registered Nurse', 'mid'), canada('Clinic Operations Manager', 'mid'), canada('Registered Nurse, Day Surgery', 'mid')]);
        assert.match(ordered[0]!, /nurse/i, ordered.join(' | '));
        assert.equal(ordered.filter((t) => /nurse/i.test(t)).length, 2, `both nursing roles are listed: ${ordered.join(' | ')}`);
    });
});

/**
 * Vivek, 2026-10-11, on Sophos's "Manager, Customer Success (Enterprise)": "why are these kinds of
 * postings being recommended for me????? this is such a weak match". It asks for 5+ years managing a
 * team and 7+ years as a CSM or account manager; his résumé reads as a mid-level TAM (5 years as one).
 * It read Good, or Strong when listed mid, as the same kind of work as his: the title "Manager, X"
 * named no level, the years it asks for were never read, and a role above his level could still be Good.
 */
describe('a role above the candidate\'s level is a Stretch, whatever says so', () => {
    const remote = (title: string, experience_level: string, extra: Partial<PublicJob> = {}) =>
        canada(title, experience_level, { work_type: 'remote', ...extra });
    const seniority = (s: MatchScore) => s.components.find((c) => c.key === 'seniority')!;

    it('reads "Manager, Customer Success" as a team manager\'s role above a mid-level TAM, listed or not', () => {
        for (const level of ['unknown', 'mid']) {
            const sophos = score(TAM_MID, remote('Manager, Customer Success (Enterprise)', level))!;
            assert.equal(sophos.role, 'family');
            assert.equal(seniority(sophos).reason, 'level_below_ask');
            assert.equal(matchBand(sophos.total), 'stretch', `${level}: ${sophos.total}`);
            assert.equal(
                seniority(sophos).detail,
                'senior role: its title runs a team — above your mid level (5 years as a Technical Account Manager) · no role on your résumé shows you managing people',
            );
            assert.match(
                explainMatch(sophos),
                /It's a Stretch because its title runs a team, which makes it a senior role, above the mid level of your 5 years as a Technical Account Manager, and no role on your résumé shows you managing people\. Your résumé has \d of the \d key words/,
            );
            assert.equal(todayLeftOut(sophos), 'level');
        }
    });

    it('reads the years a role asks for: 7+ is senior, above 5 years as a TAM; 5+ is at their level', () => {
        const asks7 = score(TAM_MID, remote('Technical Account Manager', 'mid', { min_years_experience: 7 }))!;
        assert.equal(matchBand(asks7.total), 'stretch');
        assert.equal(seniority(asks7).detail, 'senior role by the 7+ years it asks for — above your mid level (5 years as a Technical Account Manager)');
        assert.match(explainMatch(asks7), /it asks for 7\+ years, which makes it a senior role, above the mid level of your 5 years/);
        const asks5 = score(TAM_MID, remote('Technical Account Manager', 'mid', { min_years_experience: 5 }))!;
        assert.equal(seniority(asks5).reason, 'level_fits');
        assert.equal(matchBand(asks5.total), 'strong');
        assert.equal(todayLeftOut(asks5), null);
    });

    it('ranks an at-level role of the same kind before an above-level one', () => {
        const manager = score(TAM_MID, remote('Manager, Customer Success (Enterprise)', 'mid'))!;
        const csm = score(TAM_MID, remote('Customer Success Manager', 'mid'))!;
        assert.ok(compareFit(csm, manager) < 0, `CSM ${csm.total} vs manager ${manager.total}`);
    });

    it('a candidate set to senior in Settings, or who holds such a title now, is at that level', () => {
        const settings = resolveCandidateSignals(TAM_MID, { configured: true, search: { experienceLevel: 'senior' }, answers: { custom: {} } });
        const asSenior = scoreJobAgainstResume(TAM_MID, remote('Senior Customer Success Manager', 'unknown'), settings)!;
        assert.equal(seniority(asSenior).reason, 'level_fits');
        assert.notEqual(matchBand(asSenior.total), 'stretch');
        const manager: ResumeData = {
            ...TAM_MID,
            experience: [{ ...TAM_MID.experience[0]!, role: 'Manager, Customer Success' }, ...TAM_MID.experience.slice(1)],
        };
        const own = score(manager, remote('Manager, Customer Success (Enterprise)', 'unknown'))!;
        assert.equal(seniority(own).reason, 'level_fits');
        assert.match(seniority(own).detail, /matches your senior level \(your title, Manager, Customer Success\)$/);
        assert.equal(own.newToManaging, undefined);
        assert.notEqual(matchBand(own.total), 'stretch');
    });
});

/**
 * Vivek, 2026-10-11, on the Sophos posting: "i dont have any managerial
 * experience...i think that should have been taken into account". A role whose
 * title manages people is a Stretch when nothing on the résumé shows its owner
 * managing anyone, whatever level they read or set: his Team Lead and
 * Technology Lead roles led the work, not people.
 */
describe('a role that manages people is a Stretch for a résumé that shows no one managed', () => {
    const remote = (title: string, experience_level: string) => canada(title, experience_level, { work_type: 'remote' });
    const asSenior = resolveCandidateSignals(TAM, { configured: true, search: { experienceLevel: 'senior' }, answers: { custom: {} } });

    it('holds a manager\'s role under Good for the TAM résumé, even set to senior, and says why', () => {
        const title = 'Manager, Customer Success (Enterprise)';
        const s = scoreJobAgainstResume(TAM, remote(title, 'senior'), asSenior)!;
        assert.equal(s.newToManaging, true, title);
        assert.equal(s.components.find((c) => c.key === 'seniority')!.reason, 'level_fits', title);
        assert.equal(matchBand(s.total), 'stretch', `${title}: ${s.total}`);
        assert.match(explainMatch(s), /It's a Stretch because (its title manages people, which no role on your résumé shows you doing|.*, and no role on your résumé shows you managing people)/, title);
        assert.equal(todayLeftOut(s), 'level', title);
        const csm = scoreJobAgainstResume(TAM, remote('Senior Customer Success Manager', 'senior'), asSenior)!;
        assert.equal(csm.newToManaging, undefined);
        assert.equal(todayLeftOut(csm), null);
    });

    it('holds a director\'s or head\'s role past senior, so above a TAM set to senior, and says both', () => {
        for (const title of ['Director, Customer Success', 'Head of Customer Success']) {
            const s = scoreJobAgainstResume(TAM, remote(title, 'senior'), asSenior)!;
            assert.equal(s.newToManaging, true, title);
            assert.equal(s.components.find((c) => c.key === 'seniority')!.reason, 'level_below_ask', title);
            assert.equal(matchBand(s.total), 'stretch', `${title}: ${s.total}`);
            assert.match(explainMatch(s), /It's a Stretch because its title \(staff, principal, director or head level\) puts it past senior, above the senior level you set in Settings, and its title manages people/, title);
            assert.equal(todayLeftOut(s), 'level', title);
        }
    });

    it('holds an Engineering Manager role for a senior engineer who never managed, not for one who did', () => {
        const em = canada('Engineering Manager', 'senior');
        const ic = score(SWE, em)!;
        assert.equal(ic.newToManaging, true);
        assert.equal(matchBand(ic.total), 'stretch');
        assert.notEqual(matchBand(score(SWE, canada('Senior Software Engineer', 'senior'))!.total), 'stretch');
        const managed: ResumeData = {
            ...SWE,
            experience: [{ ...SWE.experience[0]!, description: `${SWE.experience[0]!.description}\nManaged a team of 6 engineers.` }, ...SWE.experience.slice(1)],
        };
        assert.equal(score(managed, em)!.newToManaging, undefined);
    });
});

/**
 * Vivek, 2026-10-14: "the majority of them are staff level... way senior to senior roles". The scale ends at
 * senior, so Staff, Principal and Director titles and Executive listings read senior and fit a senior résumé.
 * They are a rung above it: held under Good, left out of the list and of Today, and kept out of the search
 * pool, unless the résumé itself shows a role at that rank.
 */
describe('a role past Senior is never recommended to a résumé that shows none', () => {
    const PAST = [
        canada('Staff Technical Account Manager', 'senior'),
        canada('Principal Customer Success Manager', 'senior'),
        canada('Director, Customer Success', 'senior'),
        canada('Technical Account Manager', 'executive', { id: 'tam-executive' }),
    ];
    const WITHIN = [
        canada('Senior Technical Account Manager', 'senior'),
        canada('Technical Account Manager', 'lead', { id: 'tam-lead' }),
        canada('Customer Success Manager', 'mid'),
    ];
    const scoreOf = (resume: ResumeData, job: PublicJob, prefs: Parameters<typeof resolveCandidateSignals>[1] = null) => scoreJobAgainstResume(resume, job, resolveCandidateSignals(resume, prefs))!;
    const listFor = (resume: ResumeData, jobs: PublicJob[], prefs: Parameters<typeof resolveCandidateSignals>[1] = null) => {
        const scores = new Map(jobs.map((job) => [job.id, scoreOf(resume, job, prefs)]));
        return orderForYouJobsByBand(jobs, (job) => scores.get(job.id) ?? null, NOW).map((job) => job.title);
    };

    it('holds each under Good with the rung named, whatever the title\'s own words match', () => {
        for (const job of PAST) {
            const s = scoreOf(TAM, job);
            assert.equal(pastSeniorRole(s), true, job.title);
            assert.equal(s.components.find((c) => c.key === 'seniority')!.reason, 'level_below_ask', job.title);
            assert.equal(matchBand(s.total), 'stretch', `${job.title}: ${s.total}`);
            assert.equal(todayLeftOut(s), 'level', job.title);
            assert.match(explainMatch(s), /past senior/, job.title);
        }
    });

    it('holds the posting Vivek sent (a Staff Product Manager listed Senior, read Strong) under Good for a senior Product Manager résumé', () => {
        const staffPm = canada('Staff Product Manager (B2B Solutions)', 'senior', { work_type: 'remote' });
        const s = scoreJobAgainstResume(PM, staffPm, resolveCandidateSignals(PM, null))!;
        assert.equal(pastSeniorRole(s), true);
        assert.equal(matchBand(s.total), 'stretch', String(s.total));
        assert.equal(todayLeftOut(s), 'level');
        assert.deepEqual(orderForYouJobsByBand([staffPm], () => s, NOW), []);
        const plain = scoreJobAgainstResume(PM, canada('Senior Product Manager', 'senior', { work_type: 'remote' }), resolveCandidateSignals(PM, null))!;
        assert.notEqual(matchBand(plain.total), 'stretch', 'the same role without the Staff rank still reads Good or Strong');
    });

    it('lists Senior and Lead roles, and drops these from the list', () => {
        const ordered = listFor(TAM, [...PAST, ...WITHIN]);
        assert.deepEqual([...ordered].sort(), WITHIN.map((job) => job.title).sort(), ordered.join(' | '));
    });

    it('does the same for a mid résumé, and Senior roles stay a Stretch for it', () => {
        for (const job of PAST) assert.equal(outsideLevel(scoreOf(TAM_MID, job)), true, job.title);
        assert.equal(outsideLevel(scoreOf(TAM_MID, canada('Senior Technical Account Manager', 'senior'))), false);
    });

    it('reads the listing alone: an Executive listing with a plain title, and a plain listing with a Staff title', () => {
        assert.equal(outsideLevel(scoreOf(TAM, canada('Technical Account Manager', 'executive'))), true);
        assert.equal(outsideLevel(scoreOf(TAM, canada('Staff Technical Account Manager', 'unknown'))), true);
        assert.equal(outsideLevel(scoreOf(TAM, canada('Technical Account Manager', 'unknown'))), false);
    });

    it('a résumé that shows a Staff or Director title, or a Settings level of Lead or Executive, keeps them', () => {
        const staff: ResumeData = { ...SWE, experience: SWE.experience.map((e, i) => (i === 0 ? { ...e, role: 'Staff Software Engineer' } : e)) };
        assert.equal(resolveCandidateSignals(staff, null).seniority.pastSenior, true);
        assert.equal(outsideLevel(scoreOf(staff, canada('Staff Software Engineer', 'lead'))), false);
        const lead = { configured: true, search: { experienceLevel: 'lead' }, answers: { custom: {} } } as Parameters<typeof resolveCandidateSignals>[1];
        assert.equal(resolveCandidateSignals(TAM, lead).seniority.pastSenior, true);
        assert.equal(outsideLevel(scoreOf(TAM, canada('Director, Customer Success', 'senior'), lead)), false);
        // Not the Director role: its title runs a team and nothing on the résumé shows managing anyone (`newToManaging`).
        assert.deepEqual(listFor(TAM, PAST, lead).sort(), PAST.map((job) => job.title).filter((t) => !/^Director/.test(t)).sort());
    });

    it('keeps them out of the search pool for a résumé that shows none, and leaves the pool alone for one that does', async () => {
        const stub = corpusStub([...PAST, ...WITHIN]);
        await rankForYou({ resume: TAM, search: stub.search, candidateDepth: 50, signals: resolveCandidateSignals(TAM, null) });
        assert.equal(stub.calls[0]!.omitPastSenior, true);
        const staffStub = corpusStub([...PAST, ...WITHIN]);
        const lead = { configured: true, search: { experienceLevel: 'lead' }, answers: { custom: {} } } as Parameters<typeof resolveCandidateSignals>[1];
        await rankForYou({ resume: TAM, search: staffStub.search, candidateDepth: 50, signals: resolveCandidateSignals(TAM, lead) });
        assert.equal(staffStub.calls[0]!.omitPastSenior, undefined);
    });

    it('the board marks a résumé-built search the same way, and a typed search not at all', () => {
        assert.deepEqual(resumeSearchMark(true), { fromResume: true, omitPastSenior: true });
        assert.deepEqual(resumeSearchMark(true, true, { value: 'senior', source: 'explicit', pastSenior: true }), { fromResume: true });
        assert.deepEqual(resumeSearchMark(false, true), { jdTerms: true });
        assert.deepEqual(resumeSearchMark(false), {});
    });
});

/**
 * Product contract: a connected AI is told the same thing about a role as the
 * person sees on velai.app. Each MCP tool that returns jobs is run on the
 * same résumé, saved preferences and listings the site scores, and its
 * fit_label must equal the label the site shows:
 *  - the job page: `withDescriptionPlace(job)`, scored with
 *    `resolveCandidateSignals(résumé, withPlaceCountries(prefs))`
 *    (jobs/[slug]/page.tsx, PublicJobDetail.tsx, fetchAgentPreferencesAction);
 *  - a list (search, the For-you deck, Today): the rows `searchJobsAction`
 *    returns after `withPlaceRestrictions`, scored the same way;
 *  - the company page: its roles scored with résumé + preferences
 *    (CompanyRoleSearch.tsx).
 * And for_you lists what the site's For-you deck lists: the pack's search,
 * one card per role (`clusterJobs`), only roles with an apply link.
 *
 * Runs in `npm run preflight` (`check:mcp`), so a change to how the site
 * labels or lists a role that the MCP tools don't make fails before merge.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
process.env.NEXT_PUBLIC_SITE_URL = 'https://velai.app';
import { toolGetJob, toolSearchJobs, toolForYou, type ToolDeps } from '../../src/lib/agent/tools';
import { toolGetCompany } from '../../src/lib/agent/company-tools';
import { NO_TAILOR_CHANGES_NOTE, rulesTailor, toolTailorResume, type TailorChangeOut } from '../../src/lib/agent/tailor-tool';
import { jobToTailorInput, tailorWithRules } from '../../src/lib/local-ai/tailor-with-engine';
import { parseResumeLocally } from '../../src/lib/local-ai/parse-resume';
import { resumeDataToZipMarkdown } from '../../src/lib/resume/to-zip-markdown';
import type { BaseResume } from '../../src/lib/resume/base-resume';
import path from 'node:path';
import { TAILOR_POSTINGS } from '../fixtures/job-descriptions/tailor-postings';
import { siteSearch } from '../../src/lib/agent/site-search';
import { withPlaceCountries } from '../../src/lib/agent/place-countries';
import { resolveCandidateSignals } from '../../src/lib/jobs/candidate-signals';
import { withDescriptionPlace, withPlaceRestrictions } from '../../src/lib/jobs/place-notes';
import { matchLabel, relevanceTerms, scoreJobAgainstResume, termAsWritten } from '../../src/lib/match/score';
import { latestCheckAt } from '../../src/lib/jobs/badges';
import { packFilters, packSearchParams } from '../../src/lib/jobs/for-you/pack-filters';
import { clusterJobs } from '../../src/lib/jobs/cluster';
import { hasLiveApplyUrl } from '../../src/lib/jobs/apply-url-health';
import type { AgentPreferences } from '../../src/lib/agent/preferences';
import type { JobSearchParams, JobSearchResult, PlaceRestriction, PublicJob } from '../../src/lib/jobs/types';
import type { ResumeData } from '../../src/types/resume';
import type { CompanyPageData } from '../../src/lib/companies/types';
import { corpusStub, mkJob, mkResume } from '../support/jobs-corpus-stub';

const NO_PREFS: AgentPreferences = { configured: false, search: {}, answers: { custom: {} } };

const CORPUS: PublicJob[] = [
    // Checked twice: the later of the two is the time the site prints.
    mkJob('ca-onsite', {
        location: 'Toronto, ON', location_city: 'Toronto', location_country: 'Canada',
        ghost_checked_at: '2026-10-10T08:00:00Z', last_observed_alive_at: '2026-10-01T08:00:00Z',
    }),
    mkJob('us-onsite', {
        location: 'Austin, TX', location_city: 'Austin', location_country: 'United States', company: 'Initech',
        tags: ['javascript', 'GraphQL'], ghost_checked_at: '2026-09-01T08:00:00Z', last_observed_alive_at: '2026-10-09T20:00:00Z',
    }),
    // Says where only in its description: the site reads it (`withPlaceRestrictions`).
    mkJob('remote-india', {
        work_type: 'remote', location: 'Remote', company: 'Globex',
        description: '<p>This is a remote role. Candidates must be based in India.</p>',
    }),
    // Says nowhere which countries it hires in.
    mkJob('remote-unplaced', { work_type: 'remote', location: 'Remote', company: 'Umbrella' }),
    mkJob('ca-senior', { title: 'Senior Software Engineer', experience_level: 'senior', location_country: 'Canada', company: 'Hooli' }),
    mkJob('ca-entry', { title: 'Junior Software Engineer', experience_level: 'entry', location_country: 'Canada', company: 'Pied Piper' }),
    // One role cross-posted in two cities, and a role with no apply link: the deck shows one card, and not the linkless one.
    mkJob('ca-repost-1', { title: 'Frontend Engineer', company: 'Stark', location_country: 'Canada', location_city: 'Toronto' }),
    mkJob('ca-repost-2', { title: 'Frontend Engineer', company: 'Stark', location_country: 'Canada', location_city: 'Ottawa' }),
    mkJob('ca-no-link', { title: 'React Developer', company: 'Wayne', location_country: 'Canada', apply_url: '' }),
];

interface Persona {
    name: string;
    resume: ResumeData;
    prefs: AgentPreferences;
}

const PERSONAS: Persona[] = [
    { name: 'résumé in Toronto, nothing saved', resume: mkResume({ location: 'Toronto, Ontario, Canada' }), prefs: NO_PREFS },
    {
        name: 'Settings says senior, in Toronto (a city that names no country)',
        resume: mkResume({ yearsOfExperience: 3 }),
        prefs: { configured: true, search: { location: 'Toronto', experienceLevel: 'senior' }, answers: { custom: {} } },
    },
    {
        name: 'Settings says Bengaluru, résumé names no place',
        resume: mkResume(),
        prefs: { configured: true, search: { location: 'Bengaluru' }, answers: { custom: {} } },
    },
    {
        name: 'Settings says remote only, résumé in the US',
        resume: mkResume({ location: 'Austin, TX' }),
        prefs: { configured: true, search: { remoteOnly: true }, answers: { custom: {} } },
    },
];

/** The test's stand-in for the index read of descriptions (`readDescriptionPlaces`). */
async function readPlaces(ids: string[]): Promise<Record<string, PlaceRestriction | null>> {
    const byId = new Map(CORPUS.map((job) => [job.id, job] as const));
    return Object.fromEntries(ids.map((id) => [id, withDescriptionPlace(byId.get(id)!).place_restriction ?? null]));
}

/** What the site shows this person on a role: the same three calls every surface makes. */
function siteLabel(persona: Persona, job: PublicJob): string | null {
    const signals = resolveCandidateSignals(persona.resume, withPlaceCountries(persona.prefs));
    const match = scoreJobAgainstResume(persona.resume, job, signals);
    return match ? matchLabel(match) : null;
}

/** A role as the site's job page scores it. */
const jobPageRow = (job: PublicJob) => withDescriptionPlace(job);

/** A page of rows as `searchJobsAction` returns them. */
const listRows = (rows: PublicJob[]) => withPlaceRestrictions(rows, { read: readPlaces });

function depsFor(persona: Persona, company?: CompanyPageData): ToolDeps {
    const corpus = corpusStub(CORPUS);
    const byId = (id: string): JobSearchResult => {
        const hits = CORPUS.filter((job) => job.id === id);
        return { hits, total: hits.length, backend: 'meilisearch', configured: true } as JobSearchResult;
    };
    const search = siteSearch({
        search: (params: JobSearchParams) => corpus.search(params),
        hydrate: async (id) => byId(id),
        rowPlaces: (hits, opts) => withPlaceRestrictions(hits, { ...opts, read: readPlaces }),
        wholePlace: withDescriptionPlace,
    });
    const unused = (name: string) => () => {
        throw new Error(`${name} is not part of this contract`);
    };
    return {
        uid: 'user-parity',
        search,
        locationVocabulary: unused('locationVocabulary') as ToolDeps['locationVocabulary'],
        upsert: unused('upsert') as ToolDeps['upsert'],
        getBaseResume: async () => ({ source: 'resume_data', resume_data: persona.resume }),
        setBaseResume: unused('setBaseResume') as ToolDeps['setBaseResume'],
        findPursuitByJobId: unused('findPursuitByJobId') as ToolDeps['findPursuitByJobId'],
        saveResumeVersion: unused('saveResumeVersion') as ToolDeps['saveResumeVersion'],
        getPreferences: async () => persona.prefs,
        setPreferences: unused('setPreferences') as ToolDeps['setPreferences'],
        listApplications: unused('listApplications') as ToolDeps['listApplications'],
        consumeRecordBudget: async () => ({ ok: true }),
        getCompanyPageData: async () => company ?? null,
        getCompanyExhaust: async () => null,
        searchCompanies: async () => [],
        tailor: rulesTailor,
    };
}

describe('MCP tools label a role the way the site does', () => {
    for (const persona of PERSONAS) {
        it(`${persona.name}: get_job's fit_label is the job page's label, for every role`, async () => {
            const deps = depsFor(persona);
            for (const job of CORPUS) {
                const out = await toolGetJob(deps, { id: job.id });
                if ('error' in out) throw new Error(`get_job ${job.id}: ${out.error}`);
                assert.equal(out.fit_label ?? null, siteLabel(persona, jobPageRow(job)), `${job.id} for ${persona.name}`);
            }
        });

        it(`${persona.name}: search_jobs' fit_label is the list's label, for every row`, async () => {
            const deps = depsFor(persona);
            const out = await toolSearchJobs(deps, { limit: 20 });
            if ('error' in out) throw new Error(out.error);
            assert.equal(out.hits.length, CORPUS.length);
            const rows = new Map((await listRows(CORPUS)).map((row) => [row.id, row] as const));
            for (const hit of out.hits) {
                assert.equal(hit.fit_label ?? null, siteLabel(persona, rows.get(hit.id)!), `${hit.id} for ${persona.name}`);
            }
        });

        it(`${persona.name}: get_company's roles carry the company page's labels`, async () => {
            const company = { domain: 'acme.com', slug: 'acme--com', name: 'Acme', jobs: CORPUS, openCount: CORPUS.length } as unknown as CompanyPageData;
            const out = await toolGetCompany(depsFor(persona, company), { slug_or_domain: 'acme.com', limit: CORPUS.length });
            if ('error' in out) throw new Error(out.error);
            for (const role of out.jobs) {
                const job = CORPUS.find((j) => j.id === role.id)!;
                assert.equal(role.fit_label ?? null, siteLabel(persona, job), `${role.id} for ${persona.name}`);
            }
        });

        it(`${persona.name}: for_you lists what the site's For-you deck lists, labelled the same`, async () => {
            const deps = depsFor(persona);
            const out = await toolForYou(deps, { limit: 20 });
            if ('error' in out) throw new Error(out.error);

            // The deck: the pack's own search, its rows as the search action returns them,
            // one card per role, only roles with an apply link (JobsContent `rankedPacks`).
            const signals = resolveCandidateSignals(persona.resume, withPlaceCountries(persona.prefs));
            const pack = await corpusStub(CORPUS).search({ ...packSearchParams(packFilters(persona.resume, signals)), limit: 100, offset: 0 });
            const deck = clusterJobs(await listRows(pack.hits))
                .map((c) => c.primary)
                .filter(hasLiveApplyUrl);

            assert.deepEqual(new Set(out.hits.map((h) => h.id)), new Set(deck.map((j) => j.id)), persona.name);
            const rows = new Map(deck.map((row) => [row.id, row] as const));
            for (const hit of out.hits) {
                assert.equal(hit.fit_label ?? null, siteLabel(persona, rows.get(hit.id)!), `${hit.id} for ${persona.name}`);
            }
        });
    }

    it('the description place changes the label (the contract above would pass vacuously otherwise)', async () => {
        const persona = PERSONAS[0]!;
        const job = CORPUS.find((j) => j.id === 'remote-india')!;
        assert.equal(siteLabel(persona, job), 'Country unclear');
        assert.equal(siteLabel(persona, jobPageRow(job)), 'Outside Canada');
        const out = await toolGetJob(depsFor(persona), { id: job.id });
        if ('error' in out) throw new Error(out.error);
        assert.equal(out.fit_label, 'Outside Canada');
    });

    it('a level set in Settings changes the label the MCP gives (scored with the saved preferences, not the résumé alone)', async () => {
        const persona = PERSONAS[1]!;
        const job = CORPUS.find((j) => j.id === 'ca-entry')!;
        const resumeOnly = scoreJobAgainstResume(persona.resume, job, resolveCandidateSignals(persona.resume));
        const out = await toolGetJob(depsFor(persona), { id: job.id });
        if ('error' in out) throw new Error(out.error);
        assert.notDeepEqual(out.match, resumeOnly, 'Settings level must reach the score');
        assert.equal(out.fit_label, siteLabel(persona, jobPageRow(job)));
    });
});

describe('the MCP carries what the job pane and the extension show besides the label', () => {
    const persona = PERSONAS[0]!;

    it('last_checked_at is the time behind the site\'s "checked" line, for every role', async () => {
        const deps = depsFor(persona);
        for (const job of CORPUS) {
            const out = await toolGetJob(deps, { id: job.id });
            if ('error' in out) throw new Error(out.error);
            assert.equal(out.last_checked_at, latestCheckAt(job), job.id);
        }
        // Not vacuous: the later stamp wins either way round, and no stamp is null, never a stand-in date.
        const at = async (id: string) => {
            const out = await toolGetJob(deps, { id });
            if ('error' in out) throw new Error(out.error);
            return out.last_checked_at;
        };
        assert.equal(await at('ca-onsite'), '2026-10-10T08:00:00Z');
        assert.equal(await at('us-onsite'), '2026-10-09T20:00:00Z');
        assert.equal(await at('remote-unplaced'), null);
    });

    it('missing_terms are the extension\'s "Not on your résumé" terms, as the posting writes them', async () => {
        const deps = depsFor(persona);
        for (const job of CORPUS) {
            const out = await toolGetJob(deps, { id: job.id });
            if ('error' in out) throw new Error(out.error);
            const expected = relevanceTerms(persona.resume, job).missing.map((term) => termAsWritten(term, job));
            assert.deepEqual(out.missing_terms, out.match ? expected : undefined, job.id);
        }
        const out = await toolGetJob(deps, { id: 'us-onsite' });
        if ('error' in out) throw new Error(out.error);
        assert.ok(out.missing_terms?.includes('GraphQL'), `got ${JSON.stringify(out.missing_terms)}`);
    });
});

describe('the MCP reads a job the way the site serves it', () => {
    /** Each read `searchJobsAction` adds after the bare search, by the name it imports. */
    function namedImports(file: string, from: string): string[] {
        const source = readFileSync(file, 'utf8');
        const pattern = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*"${from.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}"`, 'g');
        return [...source.matchAll(pattern)].flatMap((m) => m[1]!.split(',').map((s) => s.trim()).filter(Boolean));
    }

    it('the MCP route uses every description-place read the site\'s search action uses', () => {
        const site = namedImports('src/actions/jobs.ts', '@/lib/jobs/place-notes');
        const mcp = namedImports('src/app/api/mcp/route.ts', '@/lib/jobs/place-notes');
        assert.ok(site.length > 0, 'src/actions/jobs.ts no longer reads description places — update this contract');
        for (const name of site) assert.ok(mcp.includes(name), `the site's search action uses ${name}; the MCP route (src/app/api/mcp/route.ts) does not`);
    });

    it('the MCP route looks a job up through the same seam as the site\'s job pane', () => {
        assert.ok(namedImports('src/actions/jobs.ts', '@/lib/jobs/hydrate-description').includes('hydrateJobDescription'));
        assert.ok(namedImports('src/app/api/mcp/route.ts', '@/lib/jobs/hydrate-description').includes('hydrateJobDescription'));
    });
});

describe('tailor_resume tailors the way the site\'s Customize résumé does', () => {
    /** The corpus résumés as the site reads them (tests/unit/tailor-corpus.test.ts). */
    async function readCorpusResume(id: string): Promise<ResumeData> {
        const text = readFileSync(path.join(process.cwd(), 'tests/fixtures/resume-corpus', `${id}.paste.txt`), 'utf8');
        const parsed = (await parseResumeLocally(text)).data.parsed;
        return { ...parsed, generatedSummary: parsed.generatedSummary ?? '' };
    }

    function tailorDeps(base: BaseResume, jobs: PublicJob[], budget: number[] = []): ToolDeps {
        const deps = depsFor(PERSONAS[0]!);
        const byId = (id: string): JobSearchResult => {
            const hits = jobs.filter((job) => job.id === id);
            return { hits, total: hits.length, backend: 'meilisearch', configured: true } as JobSearchResult;
        };
        return {
            ...deps,
            getBaseResume: async () => base,
            search: siteSearch({
                search: async () => byId(''),
                hydrate: async (id) => byId(id),
                rowPlaces: async (hits) => hits,
                wholePlace: withDescriptionPlace,
            }),
            consumeRecordBudget: async (count) => {
                budget.push(count);
                return { ok: true };
            },
        };
    }

    const postings = Object.entries(TAILOR_POSTINGS).map(([id, posting]) =>
        mkJob(`posting-${id}`, { title: posting.title, company: posting.company ?? 'Acme', location: posting.location ?? null, description: posting.description ?? null, tags: posting.tags ?? [] }),
    );

    it('every corpus résumé gets the site\'s changes and the text its Copy gives', async () => {
        let changes = 0;
        for (const [i, id] of Object.keys(TAILOR_POSTINGS).entries()) {
            const resume = await readCorpusResume(id);
            const job = postings[i]!;
            const out = await toolTailorResume(tailorDeps({ source: 'resume_data', resume_data: resume }, postings), { job_id: job.id });
            if ('error' in out) throw new Error(`${id}: ${out.error}`);
            const site = tailorWithRules(resume, jobToTailorInput(withDescriptionPlace(job)));
            assert.deepEqual(out.changes.map((c) => [c.id, c.kind, c.why]), site.changes.map((c) => [c.id, c.kind, c.why]), id);
            for (const change of site.changes) {
                if (change.kind !== 'summary' && change.kind !== 'line') continue;
                const mine: TailorChangeOut | undefined = out.changes.find((c) => c.id === change.id);
                assert.deepEqual([mine?.before, mine?.after], [change.before, change.after], `${id} ${change.id}`);
            }
            assert.equal(out.resume_text, resumeDataToZipMarkdown(site.tailored), id);
            assert.equal(out.engine, site.engineLabel);
            changes += out.changes.length;
        }
        assert.ok(changes > 0, 'the corpus is tailored at all');
    });

    it('the nurse\'s charting reads as the posting\'s documenting, in the changes and the text', async () => {
        const i = Object.keys(TAILOR_POSTINGS).indexOf('nurse-ca');
        const resume = await readCorpusResume('nurse-ca');
        const budget: number[] = [];
        const out = await toolTailorResume(tailorDeps({ source: 'resume_data', resume_data: resume }, postings, budget), { job_id: postings[i]!.id });
        if ('error' in out) throw new Error(out.error);
        const line = out.changes.find((c) => c.after === 'Documented all assessments and medication administration in Epic.');
        assert.ok(line, JSON.stringify(out.changes.map((c) => c.after)));
        assert.match(line!.section, /·/);
        assert.ok(out.resume_text.includes('Documented all assessments and medication administration in Epic.'));
        assert.deepEqual(budget, [1], 'reading the posting counts once against the record budget');
    });

    it('a résumé that already reads like the posting gets no changes and the site\'s note', async () => {
        const resume = mkResume();
        const job = mkJob('plain', { title: 'Zookeeper', description: null, tags: [] });
        const out = await toolTailorResume(tailorDeps({ source: 'resume_data', resume_data: resume }, [job]), { job_id: 'plain' });
        if ('error' in out) throw new Error(out.error);
        assert.deepEqual(out.changes, tailorWithRules(resume, jobToTailorInput(job)).changes);
        if (out.changes.length === 0) assert.equal(out.note, NO_TAILOR_CHANGES_NOTE);
    });

    it('needs the structured résumé: none, or text only, is an error that names what to do', async () => {
        const none = await toolTailorResume(tailorDeps({ source: 'none' }, postings), { job_id: postings[0]!.id });
        assert.deepEqual(none, { error: 'no résumé on file — call set_resume first, then retry tailor_resume' });
        const textOnly = await toolTailorResume(tailorDeps({ source: 'resume_text', resume_text: 'Nurse' }, postings), { job_id: postings[0]!.id });
        assert.ok('error' in textOnly && textOnly.error.includes('plain text only') && textOnly.error.endsWith('retry tailor_resume'));
        const missing = await toolTailorResume(tailorDeps({ source: 'resume_data', resume_data: mkResume() }, postings), { job_id: 'nope' });
        assert.deepEqual(missing, { error: 'job not found' });
    });

    it('the route\'s rules engine is the site\'s no-model tailor', async () => {
        const resume = await readCorpusResume('accountant-ca');
        const job = postings[0]!;
        assert.deepEqual(await rulesTailor(resume, job), tailorWithRules(resume, jobToTailorInput(job)));
    });
});

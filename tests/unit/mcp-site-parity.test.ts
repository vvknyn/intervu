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
import { siteSearch } from '../../src/lib/agent/site-search';
import { withPlaceCountries } from '../../src/lib/agent/place-countries';
import { resolveCandidateSignals } from '../../src/lib/jobs/candidate-signals';
import { withDescriptionPlace, withPlaceRestrictions } from '../../src/lib/jobs/place-notes';
import { matchLabel, scoreJobAgainstResume } from '../../src/lib/match/score';
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
    mkJob('ca-onsite', { location: 'Toronto, ON', location_city: 'Toronto', location_country: 'Canada' }),
    mkJob('us-onsite', { location: 'Austin, TX', location_city: 'Austin', location_country: 'United States', company: 'Initech' }),
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

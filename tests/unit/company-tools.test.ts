import { describe, it } from 'node:test'; import assert from 'node:assert/strict';
process.env.NEXT_PUBLIC_SITE_URL = 'https://intervuhq.com';
import {
  resolveCompanyDomain, toolGetCompany, toolGetCompanyTimeline, toolSearchCompanies,
} from '../../src/lib/agent/company-tools';
import type { ToolDeps } from '../../src/lib/agent/tools';
import { AGENT } from '../../src/lib/agent/config';
import { getCompanyInput } from '../../src/lib/agent/mcp-tool-specs';
import { CHANGE_HISTORY_LIMIT, type CompanyExhaust, type ChangeEventRow } from '../../src/lib/companies/exhaust';
import type { CompanyPageData } from '../../src/lib/companies/types';
import { COMPANY_JOBS_FETCH_LIMIT } from '../../src/lib/companies/get-company';
import type { CompanySearchHit } from '../../src/lib/companies/company-search';

function notImplemented(name: string) {
  return () => {
    throw new Error(`${name} should not be called by a company-tools test`);
  };
}

/** Every ToolDeps field the company tools DON'T touch is a throwing stub —
 *  if a future change makes one of them reachable from these tools, the
 *  test fails loudly instead of silently returning an undefined-shaped
 *  value. Only the 3 company-read fields are meant to be overridden. */
function baseDeps(overrides: Partial<ToolDeps> = {}): ToolDeps {
  return {
    uid: 'user-abc',
    search: notImplemented('search'),
    locationVocabulary: notImplemented('locationVocabulary'),
    upsert: notImplemented('upsert'),
    // get_company scores its roles for the caller (`candidateFor`): no résumé
    // on file here, so the preferences are never read.
    getBaseResume: async () => ({ source: 'none' }),
    setBaseResume: notImplemented('setBaseResume'),
    findPursuitByJobId: notImplemented('findPursuitByJobId'),
    saveResumeVersion: notImplemented('saveResumeVersion'),
    getPreferences: notImplemented('getPreferences'),
    setPreferences: notImplemented('setPreferences'),
    listApplications: notImplemented('listApplications'),
    consumeRecordBudget: notImplemented('consumeRecordBudget'),
    getCompanyPageData: async () => null,
    getCompanyExhaust: async () => null,
    searchCompanies: async () => [],
    tailor: notImplemented('tailor'),
    getDailyPicks: notImplemented('getDailyPicks'),
    setDailyPicksEmail: notImplemented('setDailyPicksEmail'),
    ...overrides,
  };
}

function makeCompanyPage(overrides: Partial<CompanyPageData> = {}): CompanyPageData {
  return {
    domain: 'acme.com',
    slug: 'acme--com',
    name: 'Acme Corp',
    nameSource: 'corpus',
    oneLiner: null,
    stage: null,
    openCount: 3,
    openCountIsLowerBound: false,
    ghostFlaggedPct: null,
    jobs: [],
    boards: [],
    changeEvents: [],
    exhaust: null,
    nowMs: 1_700_000_000_000,
    ...overrides,
  } as CompanyPageData;
}

/** Minimal `PublicJob`-shaped fixture, parameterized by `id` so every
 *  `toolGetCompany` test below — the wire-allowlist test included — can
 *  build one job or a distinct page of N jobs without repeating the shape. */
function makeJob(id: string): CompanyPageData['jobs'][number] {
  return {
    id, title: 'Engineer', company: 'Acme', company_domain: 'acme.com',
    location: 'Remote', location_city: null, location_state: null, location_country: 'US',
    work_type: 'remote', description: 'x'.repeat(50), employment_type: 'full_time',
    experience_level: 'senior', salary_min: null, salary_max: null, salary_currency: null,
    salary_period: null, visa_sponsorship: false, tags: [], apply_url: 'https://acme.com/apply',
    source: 'greenhouse', posted_at: '2026-07-20T00:00:00.000Z', first_seen_at: '2026-07-19T00:00:00.000Z',
    updated_at: '2026-07-21T00:00:00.000Z', vacancy_status: 'open', ghost_badge: 'clear',
  } as CompanyPageData['jobs'][number];
}

function makeExhaust(overrides: Partial<CompanyExhaust> = {}): CompanyExhaust {
  return {
    profile: null, funding: null, secListing: null, govContracts: null,
    h1bLca: null, warnNotices: null,
    health: null, cadence: null, integrity: null, techStack: null,
    changeHistory: null, sector: null, careersUrl: null,
    ...overrides,
  };
}

describe('resolveCompanyDomain', () => {
  it('decodes a dash-encoded URL slug back to a domain', () => {
    assert.equal(resolveCompanyDomain('acme--com'), 'acme.com');
  });

  it('accepts a bare domain the caller typed directly', () => {
    assert.equal(resolveCompanyDomain('Acme.COM'), 'acme.com');
  });

  it('rejects free text with no dot and no -- encoding', () => {
    assert.equal(resolveCompanyDomain('acme corp'), null);
  });

  it('rejects a domain-shaped string containing whitespace', () => {
    assert.equal(resolveCompanyDomain('acme .com'), null);
  });

  it('rejects an empty/whitespace-only input', () => {
    assert.equal(resolveCompanyDomain('   '), null);
  });
});

describe('toolGetCompany', () => {
  it('returns an error for an unresolvable identifier without calling getCompanyPageData', async () => {
    const deps = baseDeps();
    const out = await toolGetCompany(deps, { slug_or_domain: 'not a domain' });
    assert.deepEqual(out, { error: 'invalid company identifier' });
  });

  it('returns "company not found" when getCompanyPageData resolves null', async () => {
    const deps = baseDeps({ getCompanyPageData: async () => null });
    const out = await toolGetCompany(deps, { slug_or_domain: 'acme.com' });
    assert.deepEqual(out, { error: 'company not found' });
  });

  it('returns a distinct "search backend unavailable" error, not "not found", when getCompanyPageData throws', async () => {
    const deps = baseDeps({
      getCompanyPageData: async () => {
        throw new Error('jobs search backend down');
      },
    });
    const out = await toolGetCompany(deps, { slug_or_domain: 'acme.com' });
    assert.deepEqual(out, { error: 'search backend unavailable' });
  });

  it('re-maps jobs through the SAME wire allowlist search_jobs/get_job use, and passes the rest of the page through', async () => {
    const job = makeJob('job-1');
    const page = makeCompanyPage({ jobs: [job], openCount: 1 });
    const deps = baseDeps({
      getCompanyPageData: async (slug) => (slug === 'acme--com' ? page : null),
      consumeRecordBudget: async () => ({ ok: true }),
    });
    const out = await toolGetCompany(deps, { slug_or_domain: 'acme.com' });
    if ('error' in out) throw new Error('unexpected error shape');
    assert.equal(out.domain, 'acme.com');
    assert.equal(out.openCount, 1);
    assert.equal(out.jobs.length, 1);
    // toJobDetailFields's wire allowlist drops raw job fields like `description`.
    assert.ok(!('description' in out.jobs[0]));
    assert.equal(out.jobs[0].id, 'job-1');
  });

  it('meters embedded jobs against the daily record budget — 25 jobs, no limit, clamps to AGENT.RESULT_CAP and budgets exactly that many', async () => {
    const jobs = Array.from({ length: 25 }, (_, i) => makeJob(`job-${i}`));
    const page = makeCompanyPage({ jobs, openCount: 25 });
    let budgetedCount: number | undefined;
    const deps = baseDeps({
      getCompanyPageData: async () => page,
      consumeRecordBudget: async (count) => {
        budgetedCount = count;
        return { ok: true };
      },
    });
    const out = await toolGetCompany(deps, { slug_or_domain: 'acme.com' });
    if ('error' in out) throw new Error('unexpected error shape');
    assert.equal(out.jobs.length, AGENT.RESULT_CAP);
    assert.equal(budgetedCount, AGENT.RESULT_CAP);
  });

  it('a caller-supplied limit below RESULT_CAP both slices the jobs and meters the smaller count', async () => {
    const jobs = Array.from({ length: 25 }, (_, i) => makeJob(`job-${i}`));
    const page = makeCompanyPage({ jobs, openCount: 25 });
    let budgetedCount: number | undefined;
    const deps = baseDeps({
      getCompanyPageData: async () => page,
      consumeRecordBudget: async (count) => {
        budgetedCount = count;
        return { ok: true };
      },
    });
    const out = await toolGetCompany(deps, { slug_or_domain: 'acme.com', limit: 3 });
    if ('error' in out) throw new Error('unexpected error shape');
    assert.equal(out.jobs.length, 3);
    assert.equal(budgetedCount, 3);
  });

  it('withholds jobs (not the whole profile) when the daily record budget is exhausted — openCount stays the true total', async () => {
    const jobs = [makeJob('job-1'), makeJob('job-2')];
    const page = makeCompanyPage({ jobs, openCount: 2, name: 'Acme Corp' });
    const deps = baseDeps({
      getCompanyPageData: async () => page,
      consumeRecordBudget: async () => ({ ok: false, error: 'x' }),
    });
    const out = await toolGetCompany(deps, { slug_or_domain: 'acme.com' });
    if ('error' in out) throw new Error('unexpected error shape');
    assert.deepEqual(out.jobs, []);
    assert.equal(out.note, 'x');
    assert.equal(out.openCount, 2);
    assert.equal(out.name, 'Acme Corp');
  });
});

describe('getCompanyInput (limit bounds — MCP wire schema)', () => {
  it('rejects limit: 0 (below the minimum)', () => {
    assert.equal(getCompanyInput.safeParse({ slug_or_domain: 'acme.com', limit: 0 }).success, false);
  });

  it('rejects a limit above COMPANY_JOBS_FETCH_LIMIT', () => {
    assert.equal(
      getCompanyInput.safeParse({ slug_or_domain: 'acme.com', limit: COMPANY_JOBS_FETCH_LIMIT + 1 }).success,
      false,
    );
  });

  it('accepts a limit exactly at COMPANY_JOBS_FETCH_LIMIT', () => {
    assert.equal(
      getCompanyInput.safeParse({ slug_or_domain: 'acme.com', limit: COMPANY_JOBS_FETCH_LIMIT }).success,
      true,
    );
  });
});

describe('toolGetCompanyTimeline', () => {
  it('returns an error for an unresolvable identifier', async () => {
    const deps = baseDeps();
    const out = await toolGetCompanyTimeline(deps, { slug_or_domain: '' });
    assert.deepEqual(out, { error: 'invalid company identifier' });
  });

  it('returns "exhaust data unavailable" when getCompanyExhaust resolves null (box unreachable), never an empty events list', async () => {
    const deps = baseDeps({ getCompanyExhaust: async () => null });
    const out = await toolGetCompanyTimeline(deps, { slug_or_domain: 'acme.com' });
    assert.deepEqual(out, { error: 'exhaust data unavailable' });
  });

  it('returns an honest empty events list for a real company with no published change history', async () => {
    const deps = baseDeps({ getCompanyExhaust: async () => makeExhaust({ changeHistory: null }) });
    const out = await toolGetCompanyTimeline(deps, { slug_or_domain: 'acme.com' });
    assert.deepEqual(out, { events: [] });
  });

  it('returns events newest-first as stored, and clamps to CHANGE_HISTORY_LIMIT even if a caller asks for more', async () => {
    const events: ChangeEventRow[] = Array.from({ length: 5 }, (_, i) => ({
      eventType: 'hiring_surge', direction: 'improving', title: `Event ${i}`,
      occurredAt: `2026-08-${20 + i}T00:00:00.000Z`, confidence: 0.8,
    }));
    const deps = baseDeps({
      getCompanyExhaust: async () => makeExhaust({ changeHistory: { data: events, source: 'x', label: 'x', asOf: '2026-08-27T00:00:00.000Z' } }),
    });
    const out = await toolGetCompanyTimeline(deps, { slug_or_domain: 'acme.com', limit: 2 });
    assert.deepEqual(out, { events: events.slice(0, 2) });
  });

  it('never returns more than CHANGE_HISTORY_LIMIT even if the wire schema is bypassed with an oversized limit', async () => {
    const events: ChangeEventRow[] = Array.from({ length: CHANGE_HISTORY_LIMIT + 10 }, (_, i) => ({
      eventType: 'hiring_surge', direction: 'improving', title: null,
      occurredAt: '2026-08-20T00:00:00.000Z', confidence: null,
    }));
    const deps = baseDeps({
      getCompanyExhaust: async () => makeExhaust({ changeHistory: { data: events, source: 'x', label: 'x', asOf: '2026-08-27T00:00:00.000Z' } }),
    });
    const out = await toolGetCompanyTimeline(deps, { slug_or_domain: 'acme.com', limit: 999 });
    if ('error' in out) throw new Error('unexpected error shape');
    assert.equal(out.events.length, CHANGE_HISTORY_LIMIT);
  });
});

describe('toolSearchCompanies', () => {
  it('passes the query straight through and relays deps.searchCompanies\'s result verbatim', async () => {
    const hits: CompanySearchHit[] = [{ domain: 'acme.com', name: 'Acme', industries: [], hqCountry: 'US', openRolesHint: 4 }];
    let seenQuery: string | undefined;
    const deps = baseDeps({
      searchCompanies: async (query) => {
        seenQuery = query;
        return hits;
      },
    });
    const out = await toolSearchCompanies(deps, { query: 'acme' });
    assert.equal(seenQuery, 'acme');
    assert.deepEqual(out, { companies: hits });
  });

  it('applies AGENT.COMPANY_SEARCH_LIMIT as the default limit', async () => {
    let seenLimit: number | undefined;
    const deps = baseDeps({ searchCompanies: async (_q, limit) => { seenLimit = limit; return []; } });
    await toolSearchCompanies(deps, { query: 'acme' });
    assert.equal(seenLimit, AGENT.COMPANY_SEARCH_LIMIT);
  });

  it('clamps a caller-supplied limit above AGENT.COMPANY_SEARCH_LIMIT down to the cap', async () => {
    let seenLimit: number | undefined;
    const deps = baseDeps({ searchCompanies: async (_q, limit) => { seenLimit = limit; return []; } });
    await toolSearchCompanies(deps, { query: 'acme', limit: 500 });
    assert.equal(seenLimit, AGENT.COMPANY_SEARCH_LIMIT);
  });
});

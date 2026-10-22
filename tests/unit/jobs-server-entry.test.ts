/**
 * /jobs' server entry: a signed-in visitor's first frame is decided on the server
 * (src/lib/jobs/server-entry.ts), and the redirect lands on the very address the client's
 * auto-fit used to replace a bare /jobs with.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveCandidateSignals } from '../../src/lib/jobs/candidate-signals';
import { packFilters } from '../../src/lib/jobs/for-you/pack-filters';
import { mergeFacets } from '../../src/lib/jobs/resume-match';
import {
    ENTRY_BUDGET_MS,
    fitEntryPath,
    resolveJobsEntry,
    withinBudget,
} from '../../src/lib/jobs/server-entry';
import { serializeJobsUrl, parseJobsUrl, DEFAULT_URL_STATE } from '../../src/lib/jobs/url-state';
import { jobsHomeHold } from '../../src/lib/auth/jobs-chrome-gates';
import { structureResumeText } from '../../src/lib/resume/structure-resume-text';
import type { AgentPreferences } from '../../src/lib/agent/preferences';
import type { ResumeData } from '../../src/types/resume';

const golden = (name: string): ResumeData =>
    structureResumeText(readFileSync(path.join(process.cwd(), `tests/fixtures/${name}.txt`), 'utf8').replace(/'/g, '’')) as ResumeData;
const PM = golden('vivek-pm-resume');
const SWE = golden('sample-resume');

const NO_PREFS: AgentPreferences = { configured: false, search: {}, answers: { custom: {} } };
const USER = { uid: 'u1', email: 'a@b.co' };
const bare = (qs = '') => new URLSearchParams(qs);

/** The client's auto-fit before the server shared it: JobsContent `applyFit` at rest, copied as the oracle. */
function legacyClientFitPath(r: ResumeData, prefs: AgentPreferences | null): string {
    const { q, facets: packFacets, postedBucket } = packFilters(r, resolveCandidateSignals(r, prefs));
    const merged = mergeFacets({}, { ...packFacets });
    return `/jobs${serializeJobsUrl({ ...DEFAULT_URL_STATE, q, facets: merged, sort: 'fit', postedBucket, postedExplicit: true })}`;
}

describe('resolveJobsEntry', () => {
    const fit = '/jobs?q=x&sort=fit';

    it('signed in, bare address, résumé on file: redirect to the fit address', () => {
        assert.deepEqual(resolveJobsEntry({ user: USER, search: bare(), resumeOnFile: true, fitPath: fit }), { kind: 'redirect', url: fit });
    });

    it('a campaign tag does not make the address a search', () => {
        assert.equal(resolveJobsEntry({ user: USER, search: bare('utm_source=x'), resumeOnFile: true, fitPath: fit }).kind, 'redirect');
    });

    it('signed in, no résumé: renders, seeded as signed in with no résumé', () => {
        assert.deepEqual(resolveJobsEntry({ user: USER, search: bare(), resumeOnFile: false, fitPath: null }), {
            kind: 'render',
            initial: { user: USER, resumeOnFile: false },
        });
    });

    it('a fit address that is itself bare renders, never redirects to itself', () => {
        for (const degenerate of ['/jobs', '/jobs?utm_source=x']) {
            assert.equal(resolveJobsEntry({ user: USER, search: bare(), resumeOnFile: true, fitPath: degenerate }).kind, 'render');
        }
    });

    it('any address without a sort redirects (a search, a job, a filter): the fit address is built from it', () => {
        for (const qs of ['q=pm', 'job=abc', 'work=remote']) {
            assert.deepEqual(resolveJobsEntry({ user: USER, search: bare(qs), resumeOnFile: true, fitPath: fit }), { kind: 'redirect', url: fit }, qs);
        }
    });

    it('an explicit sort of any kind or an importer link renders, never redirects', () => {
        for (const qs of ['sort=newest', 'q=pm&sort=relevance', 'sort=salary', 'sort=fit', 'resume=1']) {
            const entry = resolveJobsEntry({ user: USER, search: bare(qs), resumeOnFile: true, fitPath: fit });
            assert.deepEqual(entry, { kind: 'render', initial: { user: USER, resumeOnFile: true } }, qs);
        }
    });

    it('a text-only résumé (no structured copy to rank by on the server) renders with the résumé on file', () => {
        assert.deepEqual(resolveJobsEntry({ user: USER, search: bare(), resumeOnFile: true, fitPath: null }), {
            kind: 'render',
            initial: { user: USER, resumeOnFile: true },
        });
    });

    it('reads that missed the budget render with the résumé unknown, so the client asks as before', () => {
        assert.deepEqual(resolveJobsEntry({ user: USER, search: bare(), resumeOnFile: null, fitPath: null }), {
            kind: 'render',
            initial: { user: USER, resumeOnFile: null },
        });
    });

    it('signed out: nothing seeded', () => {
        assert.deepEqual(resolveJobsEntry({ user: null, search: bare(), resumeOnFile: null, fitPath: null }), { kind: 'render', initial: null });
    });
});

describe('fitEntryPath from an address that already carries a search', () => {
    it('keeps the typed query and filters and adds only sort=fit (a typed search is theirs)', () => {
        for (const qs of ['q=data+engineer', 'q=nurse&work=remote&exp=senior']) {
            const current = parseJobsUrl(bare(qs));
            const path = fitEntryPath(PM, NO_PREFS, current);
            const got = parseJobsUrl(new URLSearchParams(path.split('?')[1]));
            assert.equal(got.q, current.q, qs);
            assert.deepEqual(got.facets, current.facets, qs);
            assert.equal(got.sort, 'fit', qs);
        }
    });
    it('company-scoped, filter-only and posted-window addresses are ranked as is: no pack query or facets', () => {
        for (const qs of ['company=harrods.com', 'work=remote', 'exp=senior&posted=7d']) {
            const current = parseJobsUrl(bare(qs));
            const got = parseJobsUrl(new URLSearchParams(fitEntryPath(PM, NO_PREFS, current).split('?')[1]));
            assert.deepEqual({ ...got, sort: null }, current, qs);
            assert.equal(got.sort, 'fit', qs);
        }
    });
    it('a bare address still takes the résumé pack', () => {
        const got = parseJobsUrl(new URLSearchParams(fitEntryPath(PM, NO_PREFS).split('?')[1]));
        assert.notEqual(got.q, '');
        assert.equal(got.postedBucket, '30d');
    });
    it('a job link keeps its job', () => {
        const got = parseJobsUrl(new URLSearchParams(fitEntryPath(PM, NO_PREFS, parseJobsUrl(bare('job=abc'))).split('?')[1]));
        assert.equal(got.jobId, 'abc');
    });
});

describe('fitEntryPath', () => {
    it('is the address the client auto-fit replaced a bare /jobs with, for two different résumés', () => {
        const prefs = NO_PREFS;
        for (const r of [PM, SWE]) {
            const path = fitEntryPath(r, prefs);
            assert.equal(path, legacyClientFitPath(r, prefs));
            assert.match(path, /^\/jobs\?q=.+sort=fit/);
            assert.match(path, /posted=30d/);
        }
        assert.notEqual(fitEntryPath(PM, prefs), fitEntryPath(SWE, prefs));
    });

    it('carries a stated role preference, as the client does', () => {
        const prefs: AgentPreferences = {
            configured: true,
            search: { query: 'Data Scientist', remoteOnly: true },
            answers: { custom: {} },
        };
        const path = fitEntryPath(PM, prefs);
        assert.equal(path, legacyClientFitPath(PM, prefs));
        assert.notEqual(path, fitEntryPath(PM, NO_PREFS));
        assert.match(path, /work=remote/);
    });
});

describe('withinBudget', () => {
    it('returns the value when it lands in time', async () => {
        assert.equal(await withinBudget(Promise.resolve(7), 50), 7);
    });
    it('returns null, not a made-up value, when the read is slower than the budget', async () => {
        assert.equal(await withinBudget(new Promise((r) => setTimeout(() => r(1), 80)), 10), null);
    });
    it('returns null when the read fails', async () => {
        assert.equal(await withinBudget(Promise.reject(new Error('down')), 50), null);
    });
    it('budget is the specified 400 ms', () => assert.equal(ENTRY_BUDGET_MS, 400));
});

describe('jobsHomeHold: the first frame never shows the front door to a signed-in résumé user', () => {
    const base = { signedIn: true, atRest: true, searchIntent: false, resumeOnFile: true, autoFitEligible: true, autoFitSettled: false, pendingExpired: false };

    it('holds for the fit list while it is fetched', () => assert.equal(jobsHomeHold(base), 'fit'));
    it('holds for the session until résumé presence is known', () => assert.equal(jobsHomeHold({ ...base, resumeOnFile: null }), 'resume'));
    it('lets the front door show once the auto-fit settled without a list', () => assert.equal(jobsHomeHold({ ...base, autoFitSettled: true }), null));
    it('signed in without a résumé: the search home, no hold', () => assert.equal(jobsHomeHold({ ...base, resumeOnFile: false }), null));
    it('signed out is untouched', () => {
        assert.equal(jobsHomeHold({ ...base, signedIn: false, resumeOnFile: false }), null);
        assert.equal(jobsHomeHold({ ...base, signedIn: false, resumeOnFile: null }), null);
    });
    it('a filter, sort or submit the visitor chose is theirs: no hold', () => assert.equal(jobsHomeHold({ ...base, autoFitEligible: false }), null));
    it('a search typed, or the time cap, ends any hold', () => {
        assert.equal(jobsHomeHold({ ...base, searchIntent: true }), null);
        assert.equal(jobsHomeHold({ ...base, pendingExpired: true }), null);
        assert.equal(jobsHomeHold({ ...base, resumeOnFile: null, pendingExpired: true }), null);
    });
});

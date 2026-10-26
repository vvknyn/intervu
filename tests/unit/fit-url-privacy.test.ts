import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { derivedByFit, fitApplication, fitRankUrlState, fitUrlState, withoutResumeDerived } from '../../src/lib/jobs/for-you/pack-filters';
import { DEFAULT_URL_STATE, parseJobsUrl, serializeJobsUrl, type JobsUrlState } from '../../src/lib/jobs/url-state';
import { buildReturnTo } from '../../src/lib/jobs/pending-actions';
import { signupGateHrefs } from '../../src/lib/auth/post-auth-destination';
import { buildMatchQuery } from '../../src/lib/jobs/resume-match';
import { processBatch } from '../../src/lib/telemetry/ingest';
import { stripUrlQueries } from '../../src/lib/posthog-options';
import type { AgentPreferences } from '../../src/lib/agent/preferences';
import type { ResumeData } from '../../src/types/resume';

const NO_PREFS: AgentPreferences = { configured: false, search: {}, answers: { custom: {} } };
const job = (role: string, company: string) => ({ role, company, startDate: '2021-01', endDate: 'Present', bullets: [`Led ${role} work at ${company}`] });
const resumeOf = (roles: string[], location: string): ResumeData =>
    ({
        profile: { name: 'Test Person', profession: roles[0], location },
        experience: roles.map((r) => job(r, 'Acme')),
        skills: ['Kubernetes', 'Terraform', 'Go'],
        education: [],
    }) as unknown as ResumeData;

const RESUMES = [resumeOf(['Staff Platform Engineer', 'Site Reliability Engineer'], 'Lisbon, Portugal'), resumeOf(['Veterinary Technician'], 'Calgary, Canada')];

/** The address a bare fit writes: the same pipeline as JobsContent `applyFit` + `applyUrlState`. */
function fitAddress(r: ResumeData) {
    const fit = fitApplication(r, NO_PREFS, { facets: {}, postedExplicit: false });
    const state = fitUrlState(DEFAULT_URL_STATE, fit);
    return { fit, state, search: serializeJobsUrl(withoutResumeDerived(state, fit)) };
}

describe('a fit search from the résumé leaves no derived term in the address', () => {
    for (const r of RESUMES) {
        it(`${r.profile?.profession}: URL, returnTo and sign-up links carry sort=fit only`, () => {
            const { fit, state, search } = fitAddress(r);
            assert.ok(fit.q.length > 0, 'the résumé derives a query');
            assert.ok(serializeJobsUrl(state).includes('q='), 'unscrubbed, the query would be in the address');
            assert.equal(search, '?sort=fit');
            const returnTo = buildReturnTo({ pathname: '/jobs', search, hash: '' });
            const { create, signIn } = signupGateHrefs(returnTo as `/${string}`);
            const derivedWords = buildMatchQuery(r).phrases.flatMap((t) => t.toLowerCase().split(/\W+/)).filter((w) => w.length > 3);
            assert.ok(derivedWords.length > 0);
            for (const text of [search, returnTo, decodeURIComponent(create), decodeURIComponent(signIn)]) {
                for (const w of derivedWords) assert.ok(!text.toLowerCase().includes(w), `${w} in ${text}`);
            }
        });
    }
});

describe('what the visitor typed or picked still round-trips', () => {
    const { fit, state } = fitAddress(RESUMES[0]!);
    it('a typed query ranked by fit keeps its query', () => {
        const typed: JobsUrlState = { ...DEFAULT_URL_STATE, q: 'Data Analyst', facets: { work_type: ['remote'] } };
        const ranked = fitRankUrlState(typed, fit);
        assert.deepEqual(parseJobsUrl(new URLSearchParams(serializeJobsUrl(withoutResumeDerived(ranked, derivedByFit(typed, fit))))), ranked);
    });
    it('a query typed over a fit pack is written in full; the derived rest is not', () => {
        const edited: JobsUrlState = { ...state, q: 'Welder' };
        const got = parseJobsUrl(new URLSearchParams(serializeJobsUrl(withoutResumeDerived(edited, fit))));
        assert.equal(got.q, 'Welder');
        assert.equal(got.sort, 'fit');
    });
    it('a place picked by hand after the fit is kept; the derived place is not', () => {
        const picked: JobsUrlState = { ...state, facets: { ...state.facets, location_country: ['Atlantis'] } };
        const got = parseJobsUrl(new URLSearchParams(serializeJobsUrl(withoutResumeDerived(picked, fit))));
        assert.deepEqual(got.facets.location_country, ['Atlantis']);
        assert.equal(got.q, '');
    });
    it('a search that is not ranked by fit is untouched', () => {
        const plain: JobsUrlState = { ...state, sort: null };
        assert.equal(withoutResumeDerived(plain, fit), plain);
        assert.equal(withoutResumeDerived(state, null), state);
    });
});

describe('a reload on the marker alone derives the same fit from the résumé', () => {
    it('sort=fit with no q parses to a bare fit, and the stored résumé yields the pack the first load wrote', () => {
        for (const r of RESUMES) {
            const reloaded = parseJobsUrl(new URLSearchParams(fitAddress(r).search));
            assert.equal(reloaded.sort, 'fit');
            assert.equal(reloaded.q, '');
            const again = fitApplication(r, NO_PREFS, { facets: reloaded.facets, postedExplicit: reloaded.postedExplicit ?? false });
            assert.equal(again.q, fitAddress(r).fit.q);
        }
    });
});

describe('the ledger stores no query string', () => {
    const props = { return_to: '/jobs?q=Staff+Engineer&sort=fit', next: '/auth/start?next=%2Fjobs%3Fq%3DNurse', kept: 'Staff Engineer?' };
    it('ingest drops queries from return_to and nested addresses, as PostHog does', () => {
        for (const eventName of ['auth_started', 'auth_nudge_shown']) {
            const out = processBatch(
                [{ event_id: crypto.randomUUID(), session_id: crypto.randomUUID(), event_name: eventName, occurred_at: new Date().toISOString(), props }],
                Date.now(),
            );
            const row = out.rows[0]!;
            assert.equal(row.props.return_to, '/jobs');
            assert.equal(row.props.next, '/auth/start');
            assert.equal(row.props.kept, 'Staff Engineer?');
        }
    });
    it('is the scrub PostHog sends', () => {
        const sent = stripUrlQueries({ uuid: 'u', event: 'auth_started', properties: { return_to: props.return_to } } as never);
        assert.equal((sent!.properties as Record<string, unknown>).return_to, '/jobs');
    });
});

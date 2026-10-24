"use server";

import { unstable_cache } from "next/cache";
import { createApplication, updateApplication, upsertPursuitForJob } from "@/actions/application";
import { findTrackedPosting } from "@/lib/pursuits/same-posting";
import { saveJobFromExtension } from "@/lib/pursuits/save-from-extension";
import { appliedAtForTransition } from "@/lib/pursuits/applied-at";
import { stageRank, type PursuitStage } from "@/lib/pursuits/types";
import {
  getJobsBackendStatus,
  getJobsLastUpdated,
  isPostedDateFilterSupported,
  searchJobs as runSearch,
  type SearchServeMeta,
} from "@/lib/jobs/search";
import { runJobsSearch, type JobsSearchWithProbes } from "@/lib/jobs/run-search";
import { SEARCH_UNAVAILABLE_MESSAGE } from "@/lib/jobs/result-state";
import { loaded, loadFailed, type LoadResult } from "@/lib/load-result";
import {
  dedupeRelatedJobs,
  MIN_RELATED_HITS,
  pickRelatedJobs,
  relatedTitleQuery,
  type RelatedBasis,
  type RelatedSeed,
} from "@/lib/jobs/related-jobs";
import { relatedCountryIso2 } from "@/lib/jobs/related-country";
import { resolveOpenCount, type OpenCount } from "@/lib/companies/open-count";
import { resolveCorpusCount, resolveLiveCorpusCount, type CorpusCount } from "@/lib/jobs/corpus-count";
import { COMPANY_JOBS_FETCH_LIMIT } from "@/lib/companies/get-company";
import { extractCompanyAboutLine } from "@/lib/companies/about-line";
import { bucketCursorToUtcDay } from "@/lib/jobs/visit-cursor";
import { getJobById } from "@/lib/jobs/get-job";
import { withDescriptionPlace, withPlaceRestrictions } from "@/lib/jobs/place-notes";
import { SEARCH_JD_READ_DEADLINE_MS, SEARCH_JD_TYPED_READ_DEADLINE_MS, withJdTerms } from "@/lib/jobs/jd-terms";
import { getAdminDb } from "@/lib/firebase/admin";
import type { ResumeData } from "@/types/resume";
import { isInternalPosting } from "@/lib/jobs/presentation";
import { DEFAULT_URL_STATE, jobSearchParamsFromUrlState, type JobsUrlState } from "@/lib/jobs/url-state";
import type { JobSearchParams, JobSearchResult, JobsBackendKind, PlaceClause, PublicJob } from "@/lib/jobs/types";
import {
  buildJobOpenEntry,
  buildSearchLogEntry,
  recordJobOpen,
  recordSearch,
  shouldLogSearch,
} from "@/lib/jobs/search-log";
import { validate, markJobAppliedSchema } from "@/lib/validation";
import { getClientIp } from "@/lib/shield/client-ip";
import { loadGazetteer } from "@/lib/geo/gazetteer";
import { placesForCountry } from "@/lib/geo/ip-default";
import { allowSearchRequest } from "@/lib/shield/rate-limit";
import { ANONYMOUS_DEPTH_GATE_MESSAGE, resolveDepthCap } from "@/lib/shield/depth-cap";
import { getServerUser } from "@/lib/auth/server-user";
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { DESCRIPTION_FILL_PREFETCH_DEADLINE_MS, planDescriptionFill } from "@/lib/jobs/fill-description";
import { fillVisibleDescriptions, hasSubspaceApiKey } from "@/lib/jobs/subspaceJobs";
import { countryLookup, hydrateJobDescription } from "@/lib/jobs/hydrate-description";
import { reportOpenedJob, reportShownJobs } from "@/lib/jobs/liveness-demand";

/**
 * `meta` is additive by convention (see `SearchServedMeta` in
 * lib/jobs/result-state.ts, the same pattern from the other lane's #38) —
 * this widens the producer side with `gated`, structurally compatible with
 * `SearchServeMeta` rather than editing that shared type (search-cache.ts is
 * outside this chokepoint's ownership). A reader with no knowledge of
 * `gated` still sees a valid `SearchServeMeta`.
 */
type ShieldSearchServeMeta = SearchServeMeta & {
  /** True when this response was refused by the anonymous depth cap rather
   *  than actually searched — hits/total are not the real result set. */
  gated?: boolean;
};

/**
 * Search the jobs corpus (dispatches to whichever backend is configured).
 *
 * Shield chokepoint (P27): every call passes through a per-IP rate limit
 * and refuses unauthenticated search before reaching the backend — signed-in
 * users get the full corpus; anonymous callers see a sign-in gate instead
 * of partial result windows.
 *
 * Also emits one anonymous telemetry event per human search. The entry is
 * built on the request (pure, cheap, and stamped with the search's own clock)
 * but WRITTEN via `after()`, so Firestore never sits on the response path and
 * a slow or broken log can't cost the searcher a millisecond.
 */
export async function searchJobsAction(
  params: JobSearchParams,
): Promise<
  Omit<JobsSearchWithProbes, "meta"> & {
    searchId: string;
    meta?: ShieldSearchServeMeta;
    /** True when the stored description is still a stub AND the live fill
     *  hit its deadline while this request awaited it — the hit's
     *  `description` is whatever we had at that point, not a final answer. */
    descriptionPending?: true;
  }
> {
  const searchId = randomUUID();
  const backendStatus = getJobsBackendStatus();

  const ip = await getClientIp();
  if (!allowSearchRequest(ip)) {
    // Same shape a real backend outage returns (search.ts's own catch) —
    // never a raw error, and never a response that reveals a rate limit is
    // in play. The client's existing one-free-retry already gives a
    // burst-limited visitor a second try a few seconds later.
    return {
      hits: [],
      total: 0,
      // Exact shape of search.ts's own real-outage catch (`configured: true`
      // verbatim — reusing the existing degraded/error result shape per
      // policy, not deriving a new one): production always has a configured
      // backend, so this only ever differs from reality in an unconfigured
      // dev environment, where it costs nothing (there's no real search to
      // protect there anyway).
      backend: backendStatus.backend,
      configured: true,
      unavailable: true,
      note: SEARCH_UNAVAILABLE_MESSAGE,
      searchId,
    };
  }

  const user = await getServerUser();
  const depthDecision = resolveDepthCap({ offset: params.offset, limit: params.limit, isAuthed: !!user });
  // Only gate when there's an actual corpus behind it — an unconfigured
  // backend already returns empty for everyone, so a "create an account"
  // gate there would be dishonest rather than protective.
  if (backendStatus.configured && depthDecision.gated) {
    return {
      hits: [],
      total: 0,
      backend: backendStatus.backend,
      configured: true,
      note: ANONYMOUS_DEPTH_GATE_MESSAGE,
      searchId,
      meta: { degraded: false, servedFrom: "live", gated: true },
    };
  }

  // Id-scoped lookup: delegate entirely to the shared hydrate seam (also
  // used by `GET /api/jobs/[id]/description`) rather than duplicating its
  // Meili-lookup-then-await-fill logic here. Every gate above this line
  // (rate limit, depth cap) still runs first, exactly as it did before this
  // extraction — only the id-specific search + fill logic moved.
  if (params.id) {
    reportOpenedJob(params.id);
    return hydrateJobDescription(params.id, ip);
  }

  const result = await runJobsSearch(
    { ...params, limit: depthDecision.effectiveLimit },
    { clientIp: ip, countryLookup },
  );

  // Only the "prefetch" plan is reachable here — `planDescriptionFill`
  // returns "await" only when `params.id` is set, and that path returned
  // above already.
  const fillPlan = planDescriptionFill(params, result.hits, result.unavailable);
  if (hasSubspaceApiKey() && fillPlan.mode === "prefetch") {
    after(() => {
      void fillVisibleDescriptions(fillPlan.ids, { timeoutMs: DESCRIPTION_FILL_PREFETCH_DEADLINE_MS }).catch((e) =>
        console.error("[jobs-desc-fill] prefetch failed:", e),
      );
    });
  }

  if (shouldLogSearch(params)) {
    const entry = buildSearchLogEntry(params, result, { searchId, now: Date.now() });
    after(() => recordSearch(entry));
  }

  // Buffer-only (no await, no network here): the rows this person is about
  // to see go to Subspace's liveness verifier first. See liveness-demand.ts.
  reportShownJobs(result.hits);

  // What each row's description says about where the person must be, so a
  // role for people in another country never reads as a fit in any list.
  // A résumé-ranked search (a pack, Rank by fit, the hub probe) also gets each
  // row's requirement and duty terms, so the browser scores the whole posting
  // against the résumé it holds, not the title alone (jd-terms.ts). Both reads
  // run together; each answers within its own deadline. A résumé-built search
  // gives the place read the terms read's deadline: its deeper list holds the
  // remote roles that name no country, and the response waits for the terms anyway.
  const [placed, withTerms] = await Promise.all([
    params.fromResume ? withPlaceRestrictions(result.hits, { deadlineMs: SEARCH_JD_READ_DEADLINE_MS }) : withPlaceRestrictions(result.hits),
    // A résumé-built search waits a little longer for the terms (its whole
    // order depends on them); a typed search by someone holding a résumé gets
    // them within the place read's own budget, so it is no slower.
    params.fromResume
      ? withJdTerms(result.hits)
      : params.jdTerms
        ? withJdTerms(result.hits, { deadlineMs: SEARCH_JD_TYPED_READ_DEADLINE_MS })
        : Promise.resolve(null),
  ]);
  const termed = withTerms
    ? placed.map((hit, i) => (withTerms[i]?.jd_terms !== undefined ? { ...hit, jd_terms: withTerms[i]!.jd_terms } : hit))
    : placed;
  return { ...result, hits: termed, searchId };
}

/** How many related jobs the detail panel's "More like this" shows. */
const RELATED_JOBS_LIMIT = 5;

/**
 * Fetch, filter (excluding the job itself — `JobSearchParams` has no
 * exclude-id field, so this over-fetches by one and drops it here rather
 * than inventing one), and cap to `RELATED_JOBS_LIMIT`. Shared by both of
 * `getRelatedJobsAction`'s passes below (similar roles, then the company's
 * own roles) so they can't drift on the shared shape
 * (`postedBucket`/`hideGhosts`, the exclude-self step, the cap).
 */
async function fetchRelatedExcluding(jobId: string, params: JobSearchParams): Promise<PublicJob[]> {
  const result = await runSearch({
    postedBucket: DEFAULT_URL_STATE.postedBucket,
    hideGhosts: true,
    limit: RELATED_JOBS_LIMIT + 1,
    ...params,
  });
  return withPlaceRestrictions(result.hits.filter((h) => h.id !== jobId).slice(0, RELATED_JOBS_LIMIT));
}

/**
 * The detail panel's "N live roles" figure (JobDetail.tsx) used to read a
 * sync-time aggregate baked onto the job document — structurally stale, and
 * it can disagree with /co/[slug]'s own live count for the same company.
 * Resolved here with the SAME query shape `getCompanyPageData` uses for that
 * count (companyDomain, COMPANY_JOBS_FETCH_LIMIT, no posted-window, no ghost
 * exclusion) — deliberately NOT `fetchRelatedExcluding` above, which is a
 * narrower, different-purpose query (default posted window, ghosts hidden, excludes
 * this job, caps at RELATED_JOBS_LIMIT) built for "More like this"
 * suggestions; reusing it here would just be a third, disagreeing
 * definition of "open roles" — the exact bug this closes.
 * Resolved through `resolveOpenCount`, never raw `total`, so a saturated/
 * capped result renders as a floor ("N+"), not a false exact count.
 *
 * Unguarded by `allowSearchRequest` on purpose — both callers below own
 * that check at their own entry point, and this runs one query, so gating
 * it here too would charge the caller's rate-limit budget twice for what is
 * still a single logical call.
 */
async function fetchCompanyWindow(companyDomain: string): Promise<JobSearchResult> {
  return runSearch({
    companyDomain,
    limit: COMPANY_JOBS_FETCH_LIMIT,
    hideGhosts: false,
  });
}

async function resolveCompanyOpenCount(companyDomain: string): Promise<OpenCount | null> {
  if (!companyDomain) return null;
  const countResult = await fetchCompanyWindow(companyDomain);
  return resolveOpenCount(countResult, countResult.hits.length, COMPANY_JOBS_FETCH_LIMIT);
}

/**
 * Standalone entry point for the "N live roles" figure — JobDetail.tsx calls
 * this directly (not gated behind `signedIn`, unlike `getRelatedJobsAction`'s
 * related-jobs list below) since /co/[slug] already serves this same query
 * to anonymous visitors with no sign-in gate at all.
 */
export async function getCompanyOpenCountAction(companyDomain: string): Promise<OpenCount | null> {
  if (!companyDomain) return null;
  const ip = await getClientIp();
  if (!allowSearchRequest(ip)) return null;
  return resolveCompanyOpenCount(companyDomain);
}

/**
 * The job-detail document layout's employer rail: live open-role count and
 * an "about this company" line, from ONE shared query window
 * (`fetchCompanyWindow`) instead of two separate fetches — same idiom as
 * `getCompanyPageData` (get-company.ts), which this mirrors for a single
 * job's page rather than the full /co listing. Internal-only postings are
 * filtered out before either derivation, matching that same call site, so
 * the about-line is never sourced from staffing-noise postings and the open
 * count never counts them either.
 */
export async function getCompanyRailAction(
  companyDomain: string,
  companyName: string,
): Promise<{ openCount: OpenCount | null; aboutLine: string | null }> {
  if (!companyDomain) return { openCount: null, aboutLine: null };
  const ip = await getClientIp();
  if (!allowSearchRequest(ip)) return { openCount: null, aboutLine: null };

  const result = await fetchCompanyWindow(companyDomain);
  const jobs = result.hits.filter((job) => !isInternalPosting(job.title));
  return {
    openCount: resolveOpenCount(result, jobs.length, COMPANY_JOBS_FETCH_LIMIT),
    aboutLine: extractCompanyAboutLine(jobs, companyName),
  };
}

/**
 * "More like this" (JobDetail, Curiosity / Serial Positioning Effect) — the
 * reader's next stop after a posting, without leaving the panel.
 *
 * Similar roles first: the role's significant keywords (`relatedTitleQuery`)
 * as a plain search, kept to this job's country (`relatedCountryIso2`) with
 * the same country filter the board's default browse uses. Below
 * `MIN_RELATED_HITS` of those, the company's own other roles instead
 * (`JobSearchParams.companyDomain`, the exact-match filter `/co/[slug]`'s
 * own job list uses). `basis` says which list came back, so the heading can
 * say so — see related-jobs.ts for why the company list is no longer first.
 */
export async function getRelatedJobsAction(seed: RelatedSeed): Promise<{ jobs: PublicJob[]; basis: RelatedBasis }> {
  const none = { jobs: [], basis: "title" as const };
  // Typed defensively: a server action's arguments are whatever the caller sends.
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) || null : null);
  const viewed: RelatedSeed = {
    id: text(seed?.id, 200) ?? "",
    title: text(seed?.title, 300) ?? "",
    company: text(seed?.company, 200),
    companyDomain: text(seed?.companyDomain, 200),
    location: text(seed?.location, 300),
    state: text(seed?.state, 100),
    country: text(seed?.country, 80),
  };
  if (!viewed.id) return none;

  // Same per-IP chokepoint as `searchJobsAction` above — this action runs up
  // to two corpus queries per call and is just as callable outside the UI.
  // Denial is an empty list, not an error: "More like this" is an accelerant,
  // and the panel already renders nothing for an empty result.
  const ip = await getClientIp();
  if (!allowSearchRequest(ip)) return none;

  const query = relatedTitleQuery(viewed.title);
  const iso2 = relatedCountryIso2(viewed, loadGazetteer());
  const places = iso2 ? placesForCountry(iso2, loadGazetteer()) : undefined;
  const titleHits = query
    ? dedupeRelatedJobs(await fetchRelatedExcluding(viewed.id, { q: query, ...(places ? { places } : {}) }), viewed)
    : [];
  const companyHits =
    titleHits.length < MIN_RELATED_HITS && viewed.companyDomain
      ? dedupeRelatedJobs(await fetchRelatedExcluding(viewed.id, { companyDomain: viewed.companyDomain }), viewed)
      : [];

  const related = pickRelatedJobs({ titleHits, companyHits });
  reportShownJobs(related.jobs);
  return related;
}

/** Page size for the cached default browse — mirrors `PAGE` in
 *  jobs/page.tsx (currently 20). Not imported from there: that file is
 *  "use client" and this one is "use server," so the two stay independent
 *  constants by construction rather than a cross-runtime import. */
const DEFAULT_BROWSE_LIMIT = 20;

/**
 * The fixed "default browse" shape (2026-08-07 front-door reversal, product
 * decision: a zero-query visitor must see real jobs on first paint) — empty
 * query, the app's standing posted-window default (`DEFAULT_URL_STATE`,
 * lib/jobs/url-state.ts), freshest-first, ghosts hidden (the first-screen
 * default), and the resolved country's postings when the corpus has any.
 *
 * Distinct from search-cache.ts's OWN "default browse" bookkeeping
 * (`isDefaultBrowseParams`/`DEFAULT_BROWSE_CACHE_KEY`) — that one caches the
 * fully unfiltered, no-window shape the pre-rule-§1 cold-visit browse used
 * to send before it was killed off for being the single most expensive query
 * the app issued; it survives today only as search.ts's own outage-fallback
 * key for other callers (e.g. MCP), untouched by this. This shape is bounded
 * by the default posted window, so it's cheap enough to serve fresh rather than only
 * as a degraded fallback.
 *
 * Cached 600s, keyed ONLY by the resolved `places` clause (i.e. by country —
 * `undefined` for "no country resolved," a single shared entry) — every real
 * user-typed search or filtered fetch stays on the uncached `searchJobsAction`
 * path above; this is the one fixed shape cheap enough to share across every
 * visitor from the same country instead of hitting the corpus per visitor.
 */
const getCachedDefaultBrowse = unstable_cache(
  // `postedDateSupported` is a cache-key dimension (an `unstable_cache`d
  // function's own arguments participate in its key, same as `places`
  // below) — NOT threaded into the main query itself, which stays the fixed
  // unwindowed shape this function has always served (see the doc comment
  // above). It scopes only the beyond-window probe's basis, via
  // `probeParams`, to match what page.tsx's now-deleted client probe used to
  // compute for this exact landing state (`buildJobSearchPayload` against
  // the default `FilterState`, which carries the default `postedBucket` whenever
  // the corpus can support it) — see `runJobsSearch`'s `probeParams` doc.
  async (
    places: PlaceClause[] | undefined,
    postedDateSupported: boolean,
  ): Promise<JobsSearchWithProbes> =>
    runJobsSearch(
      {
        hideGhosts: true,
        sort: "newest",
        limit: DEFAULT_BROWSE_LIMIT,
        offset: 0,
        withFacets: true,
        places,
      },
      {
        probeParams: {
          hideGhosts: true,
          postedBucket: postedDateSupported ? DEFAULT_URL_STATE.postedBucket : undefined,
          places,
        },
      },
    ),
  ["jobs-default-browse", String(DEFAULT_BROWSE_LIMIT)],
  { revalidate: 600 },
);

/**
 * Thin I/O wrapper `jobs/page.tsx`'s zero-query landing fetch calls instead
 * of `searchJobsAction` when `resolveEmptySearchState` classifies the
 * current state `"overlay-ask"` (empty query, no filters, no fit) — see that
 * function's doc comment. `searchId` and `defaultedLocation` are stamped
 * fresh on every call, outside the cache boundary, same pattern
 * `searchJobsAction` above uses for its own per-request `searchId`: a cached
 * response is shared across visitors, but each visitor's own request/open
 * telemetry and "near Country" chip still need to be theirs.
 *
 * `suppressLocationDefault` mirrors the same-named `JobSearchParams` field:
 * a visitor who already dismissed the default-location chip must not have
 * it silently reapplied just because they landed back on an empty query.
 */
export async function getDefaultBrowseAction(
  suppressLocationDefault: boolean,
): Promise<
  JobsSearchWithProbes & {
    searchId: string;
    /** See `LocationDefaultApplication.remoteAnywhere` (lib/geo/ip-default.ts)
     *  — same gate as `defaultedLocation` here too: `placesForCountry` calls
     *  the same `placeClause(..., { remoteAnywhere: true })` `resolveLocationDefault`
     *  does, so it's read off `places` itself rather than assumed. */
    remoteAnywhere?: boolean;
  }
> {
  const searchId = randomUUID();
  const ip = suppressLocationDefault ? null : await getClientIp();
  const iso2 = ip ? await countryLookup(ip) : null;
  const places = iso2 ? placesForCountry(iso2, loadGazetteer()) : undefined;
  try {
    const postedDateSupported = Boolean(await isPostedDateFilterSupported());
    const result = await getCachedDefaultBrowse(places, postedDateSupported);
    // Outside the cache: one shared entry still means many visitors seeing it.
    reportShownJobs(result.hits);
    return {
      ...result,
      searchId,
      ...(places ? { defaultedLocation: iso2!, remoteAnywhere: places.some((place) => place.remoteAnywhere) } : {}),
    };
  } catch (e) {
    console.error("[jobs-default-browse] action transport error:", e);
    return {
      hits: [],
      total: 0,
      backend: getJobsBackendStatus().backend,
      configured: true,
      unavailable: true,
      note: SEARCH_UNAVAILABLE_MESSAGE,
      searchId,
    };
  }
}

/**
 * "N new since you last looked" (round 2's board/saved-search banner).
 * `first_seen_at` is sortable but NOT in the live index's
 * filterableAttributes — a settings change would mean reindexing a
 * near-full box — so `posted_ts` is the ONLY posted-date field this (or any
 * other) count ever filters on. The cursor is expressed as
 * `JobSearchParams.postedSinceMs`, the exact same `posted_ts` translation
 * chokepoint (`buildFilter`, meilisearch.ts) `postedBucket` already goes
 * through — never a hand-built filter string here.
 *
 * The cursor is day-bucketed (UTC midnight floor, `bucketCursorToUtcDay`)
 * before it reaches a query, both so the count can't silently drift within
 * a cache window and because that floor IS the cache key board scope
 * revalidates on below. Saved scope isn't cached — per-user params vary too
 * much for a shared cache to pay for itself — but still shares the rate
 * limit both scopes open with.
 */
const getCachedBoardCountNew = unstable_cache(
  async (iso2: string | null, bucketedCursorIso: string): Promise<CorpusCount> => {
    const places = iso2 ? placesForCountry(iso2, loadGazetteer()) : undefined;
    const result = await runSearch(
      { postedSinceMs: Date.parse(bucketedCursorIso), places, limit: 1, withFacets: false },
      {},
    );
    // Throws on an outage, so a failed search isn't cached as "0 new roles".
    return resolveLiveCorpusCount(result);
  },
  ["jobs-count-new-board"],
  { revalidate: 900 },
);

/** Denial/transport-error result: an honest exact zero, not a floor — the
 *  caller renders nothing for it either way, but it must never be mistaken
 *  for "the corpus saturated at zero." */
const COUNT_NEW_UNAVAILABLE: CorpusCount = { kind: "exact", value: 0 };

export async function countNewSinceAction(
  input: { scope: "board" } | { scope: "saved"; params: JobsUrlState },
  cursorIso: string,
): Promise<CorpusCount> {
  // Same per-IP chokepoint as searchJobsAction/getRelatedJobsAction — a
  // count is an accelerant for a banner, never a primary result, so denial
  // is 0 (renders nothing) rather than an error the caller must special-case.
  const ip = await getClientIp();
  if (!allowSearchRequest(ip)) return COUNT_NEW_UNAVAILABLE;

  const bucketedCursor = bucketCursorToUtcDay(cursorIso);

  if (input.scope === "board") {
    const iso2 = ip ? await countryLookup(ip) : null;
    try {
      return await getCachedBoardCountNew(iso2, bucketedCursor);
    } catch (e) {
      console.error("[jobs-count-new] board scope transport error:", e);
      return COUNT_NEW_UNAVAILABLE;
    }
  }

  // Saved scope: the saved search's own filters (via the shared
  // `jobSearchParamsFromUrlState` mapping — also used by the digest's
  // per-saved-search fetch, lib/email/digest/collect.ts) plus the same
  // posted_ts cursor clause board scope uses above. Resolved through the
  // same `resolveCorpusCount` chokepoint jobs/page.tsx uses — `total` alone
  // saturates at Meilisearch's 100k cap exactly like any other search count
  // (see corpus-count.ts), so a bare `result.total` here would eventually
  // print a "new roles" banner claiming precisely 100,000 forever.
  const result = await runSearch(
    {
      ...jobSearchParamsFromUrlState(input.params, Date.parse(bucketedCursor)),
      limit: 1,
      withFacets: false,
    },
    { clientIp: ip, countryLookup },
  );
  return resolveCorpusCount(result);
}

/**
 * The /jobs front door's one live number: roles posted in the last 7 days
 * in the visitor's IP country, plus remote roles open anywhere (the same
 * `placesForCountry` clause the country default applies), or everywhere
 * when no country resolves. Likely ghosts stay out, as on every default
 * list. Cached per country for 15 minutes, like the board count above.
 */
const getCachedFrontDoorWeekCount = unstable_cache(
  async (iso2: string | null): Promise<CorpusCount> => {
    const places = iso2 ? placesForCountry(iso2, loadGazetteer()) : undefined;
    const result = await runSearch(
      { postedBucket: "7d", hideGhosts: true, places, limit: 1, withFacets: false },
      {},
    );
    // Throws on an outage, so a failed search isn't cached as a zero week.
    return resolveLiveCorpusCount(result);
  },
  ["jobs-front-door-week-count"],
  { revalidate: 900 },
);

/**
 * `null` whenever the number can't be stated honestly: rate limited, the
 * index can't filter by posted date (the count would be the whole corpus),
 * search down, or zero. `iso2` is the country the count covers; `null`
 * means it covers every country.
 */
export async function getFrontDoorWeekCountAction(
  suppressLocationDefault: boolean,
): Promise<{ count: CorpusCount; iso2: string | null } | null> {
  const ip = await getClientIp();
  if (!allowSearchRequest(ip)) return null;
  try {
    if (!(await isPostedDateFilterSupported())) return null;
    const looked = suppressLocationDefault || !ip ? null : await countryLookup(ip);
    // A country the gazetteer can't place would count every country under its name.
    const iso2 = looked && placesForCountry(looked, loadGazetteer()) ? looked : null;
    const count = await getCachedFrontDoorWeekCount(iso2);
    return count.value > 0 ? { count, iso2 } : null;
  } catch (e) {
    console.error("[jobs-front-door-week-count] transport error:", e);
    return null;
  }
}

/**
 * Record that a searcher opened a result, and where it sat in the list.
 *
 * `rank` is the point of the whole exercise: what people type tells us what
 * they want, but only which position they open tells us whether we answered.
 * Fire-and-forget — never awaited by the UI, never able to fail an open.
 */
export async function recordJobOpenedAction(
  searchId: string,
  jobId: string,
  rank: number,
): Promise<void> {
  // Before the rank guard: a job opened from a URL has no rank to log, but it
  // is still a listing someone is about to apply to.
  reportOpenedJob(typeof jobId === "string" ? jobId : null);
  if (!searchId || !jobId || !Number.isFinite(rank) || rank < 0) return;
  const entry = buildJobOpenEntry(searchId, String(jobId).slice(0, 128), rank, Date.now());
  after(() => recordJobOpen(entry));
}

/**
 * The last-updated timestamp of the rows `params` matches, for the "last
 * synced" trust stamp — pass the SAME params the results search used
 * (`buildJobSearchPayload`'s output) so the stamp describes the population
 * on screen; omit for the true corpus-wide stamp.
 */
export async function getJobsFreshnessAction(params: JobSearchParams = {}): Promise<string | null> {
  return getJobsLastUpdated(params);
}

/**
 * Whether the corpus can support the posted-date buckets. The rail and the
 * mobile chip hide the control when it can't, rather than offering a filter
 * that returns an empty board.
 */
export async function getPostedDateFilterSupportAction(): Promise<boolean | null> {
  return isPostedDateFilterSupported();
}

/** Report which search backend is live, for the UI's connected/empty states. */
export async function jobsBackendStatusAction(): Promise<{
  backend: JobsBackendKind;
  configured: boolean;
  note: string;
}> {
  return getJobsBackendStatus();
}

/** Fetch a single job by id. */
export async function getJobByIdAction(id: string): Promise<PublicJob | null> {
  const job = await getJobById(id);
  if (job) reportOpenedJob(job.id);
  return job ? withDescriptionPlace(job) : null;
}

/**
 * Track a job the user is applying to — the "apply → track" step of the loop.
 * Creates/advances the pursuit (stage "applied") in the user's tracker.
 * Applying itself is a deep-link out to the posting; this records that they
 * did. Generalizes onto the same find-or-create-by-job_id chokepoint
 * `goAfterJobAction` uses (`upsertPursuitForJob`) when the caller has a
 * `jobId` — so marking a job the user already went after applied advances
 * that same pursuit instead of creating a second row. `jobId` is optional so
 * a caller without one (predating the pursuit job_id linkage) still gets
 * the original plain-create behavior.
 */
export async function markJobAppliedAction(input: {
  company: string;
  title: string;
  applyUrl: string;
  jobId?: string;
}): Promise<{ data?: { id: string }; error?: string }> {
  const parsed = validate(markJobAppliedSchema, input);
  if (!parsed.ok) return { error: parsed.error };

  if (parsed.data.jobId) {
    const res = await upsertPursuitForJob(
      {
        job_id: parsed.data.jobId,
        title: parsed.data.title,
        company: parsed.data.company,
        location: null,
        description: null,
        apply_url: parsed.data.applyUrl ?? "",
      },
      "applied",
      // Marking a role Applied copies the résumé on file onto it.
      { attachResume: true },
    );
    if (res.error) return { error: res.error };
    return { data: { id: res.data!.id } };
  }

  // No job id (the browser extension on a posting Velai doesn't have): the
  // same posting URL marked again (a second click, a retry, another tab)
  // finds the row the first one made rather than adding a second.
  if (parsed.data.applyUrl) {
    const user = await getServerUser();
    if (!user) return { error: "User not authenticated" };
    const tracked = await findTrackedPosting(user.uid, parsed.data.applyUrl);
    if (tracked) {
      if (stageRank(tracked.status) >= stageRank("applied")) return { data: { id: tracked.id } };
      const appliedAt = appliedAtForTransition(tracked, "applied", new Date().toISOString());
      const moved = await updateApplication(tracked.id, { status: "applied", ...(appliedAt ? { applied_at: appliedAt } : {}) });
      if (moved.error) return { error: moved.error };
      return { data: { id: tracked.id } };
    }
  }

  const res = await createApplication({
    company_name: parsed.data.company,
    position: parsed.data.title,
    job_url: parsed.data.applyUrl,
    status: "applied",
    applied_at: new Date().toISOString(),
  });
  if (res.error) return { error: res.error };
  const id = (res.data as { id?: string } | undefined)?.id ?? "";
  return { data: { id } };
}


/**
 * Save a job to the tracker without applying: the browser extension's "Save"
 * on a job page (`saveJobFromExtension`). Writes the same Saved stage "Go after
 * this job" and the MCP `save_job` write, so it never moves a role back.
 */
export async function markJobSavedAction(input: {
  company: string;
  title: string;
  applyUrl: string;
  jobId?: string;
}): Promise<{ data?: { id: string; status: PursuitStage }; error?: string }> {
  const parsed = validate(markJobAppliedSchema, input);
  if (!parsed.ok) return { error: parsed.error };
  const res = await saveJobFromExtension(
    {
      jobById: (id) => getJobById(id),
      upsert: (job, stage) => upsertPursuitForJob(job, stage),
      findTracked: async (applyUrl) => {
        const user = await getServerUser();
        if (!user) throw new Error("User not authenticated");
        return findTrackedPosting(user.uid, applyUrl);
      },
      create: (row) => createApplication(row),
    },
    parsed.data,
  );
  return "error" in res ? { error: res.error } : { data: res.data };
}

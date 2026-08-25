"use server";

import { unstable_cache } from "next/cache";
import { createApplication, upsertPursuitForJob } from "@/actions/application";
import { generateGenericJSON } from "@/actions/generate-context";
import {
  getJobsBackendStatus,
  getJobsLastUpdated,
  isPostedDateFilterSupported,
  searchJobs as runSearch,
  type SearchServeMeta,
} from "@/lib/jobs/search";
import { SEARCH_UNAVAILABLE_MESSAGE } from "@/lib/jobs/result-state";
import { resolveRelatedQuery } from "@/lib/jobs/related-jobs";
import { resolveOpenCount, type OpenCount } from "@/lib/companies/open-count";
import { COMPANY_JOBS_FETCH_LIMIT } from "@/lib/companies/get-company";
import { bucketCursorToUtcDay } from "@/lib/jobs/visit-cursor";
import { getJobById } from "@/lib/jobs/get-job";
import { jobSearchParamsFromUrlState, type JobsUrlState } from "@/lib/jobs/url-state";
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
import { createMmdbCountryLookup } from "@/lib/geo/ip-country";
import { loadGazetteer } from "@/lib/geo/gazetteer";
import { countryPlaceCandidates } from "@/lib/geo/resolve-place";
import { allowSearchRequest } from "@/lib/shield/rate-limit";
import { ANONYMOUS_DEPTH_GATE_MESSAGE, resolveDepthCap } from "@/lib/shield/depth-cap";
import { getServerUser } from "@/lib/firebase/auth-session";
import { randomUUID } from "node:crypto";
import { after } from "next/server";

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
 * Built here, not inside `searchJobs` (search.ts) — this file is a Server
 * Action, always Node runtime, so it's safe to hold the mmdb reader (see
 * `createMmdbCountryLookup`'s own doc comment). `search.ts` also backs
 * `/co/[slug]`'s edge-runtime OG image route, which has no filesystem at
 * all, so it can only ever take this as an optional injected dependency.
 */
const countryLookup = createMmdbCountryLookup();

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
): Promise<JobSearchResult & { searchId: string; meta?: ShieldSearchServeMeta; defaultedLocation?: string }> {
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

  const result = await runSearch({ ...params, limit: depthDecision.effectiveLimit }, { clientIp: ip, countryLookup });

  if (shouldLogSearch(params)) {
    const entry = buildSearchLogEntry(params, result, { searchId, now: Date.now() });
    after(() => recordSearch(entry));
  }

  return { ...result, searchId };
}

/** How many related jobs the detail panel's "More like this" shows. */
const RELATED_JOBS_LIMIT = 5;

/**
 * Fetch, filter (excluding the job itself — `JobSearchParams` has no
 * exclude-id field, so this over-fetches by one and drops it here rather
 * than inventing one), and cap to `RELATED_JOBS_LIMIT`. Shared by both of
 * `getRelatedJobsAction`'s passes below (company-scoped, then the
 * title-keyword fallback) so they can't drift on the shared shape
 * (`postedBucket`/`hideGhosts`, the exclude-self step, the cap).
 */
async function fetchRelatedExcluding(jobId: string, params: JobSearchParams): Promise<PublicJob[]> {
  const result = await runSearch({
    postedBucket: "30d",
    hideGhosts: true,
    limit: RELATED_JOBS_LIMIT + 1,
    ...params,
  });
  return result.hits.filter((h) => h.id !== jobId).slice(0, RELATED_JOBS_LIMIT);
}

/**
 * "More like this" (JobDetail, Curiosity / Serial Positioning Effect) — the
 * one forward path out of a posting used to be a gated company link; this
 * gives the reader somewhere to go next without leaving the panel.
 *
 * Company scope reuses `JobSearchParams.companyDomain` (exact-match filter,
 * already load-bearing for `/co/[slug]`'s own job list — see
 * `buildFilter`/`passBase` in meilisearch.ts and snapshot-preview.ts) rather
 * than a new mechanism. Below `resolveRelatedQuery`'s minimum company-hit
 * count (too few, or no `companyDomain` at all — `companyHitCount` is then
 * 0 by construction, since the company-scoped fetch never even runs), it
 * widens to a title-keyword search instead; if the title itself has no
 * usable keywords, it returns whatever company hits exist rather than a
 * fabricated whole-corpus fallback (`resolveRelatedQuery`'s "none" branch).
 */

/**
 * The detail panel's "N live roles" figure (JobDetail.tsx) used to read a
 * sync-time aggregate baked onto the job document — structurally stale, and
 * it can disagree with /co/[slug]'s own live count for the same company.
 * Resolved here with the SAME query shape `getCompanyPageData` uses for that
 * count (companyDomain, COMPANY_JOBS_FETCH_LIMIT, no posted-window, no ghost
 * exclusion) — deliberately NOT `fetchRelatedExcluding` above, which is a
 * narrower, different-purpose query (30d window, ghosts hidden, excludes
 * this job, caps at RELATED_JOBS_LIMIT) built for "More like this"
 * suggestions; reusing it here would just be a third, disagreeing
 * definition of "open roles" — the exact bug this closes.
 * Resolved through `resolveOpenCount`, never raw `total`, so a saturated/
 * capped result renders as a floor ("N+"), not a false exact count.
 *
 * Unguarded by `allowSearchRequest` on purpose — both callers below own
 * that check at their own entry point, and this runs one query, so gating
 * it here too would silently double-charge `getRelatedJobsAction`'s shared
 * rate-limit budget for what is still a single logical call.
 */
async function resolveCompanyOpenCount(companyDomain: string): Promise<OpenCount | null> {
  if (!companyDomain) return null;
  const countResult = await runSearch({
    companyDomain,
    limit: COMPANY_JOBS_FETCH_LIMIT,
    hideGhosts: false,
  });
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

export async function getRelatedJobsAction(
  jobId: string,
  companyDomain: string | null | undefined,
  title: string,
): Promise<{ jobs: PublicJob[]; openCount: OpenCount | null }> {
  if (!jobId) return { jobs: [], openCount: null };

  // Same per-IP chokepoint as `searchJobsAction` above — this action runs up
  // to three corpus queries per call and is just as callable outside the UI.
  // Denial is an empty list, not an error: "More like this" is an accelerant,
  // and the panel already renders nothing for an empty result.
  const ip = await getClientIp();
  if (!allowSearchRequest(ip)) return { jobs: [], openCount: null };

  const companyHits = companyDomain ? await fetchRelatedExcluding(jobId, { companyDomain }) : [];
  const plan = resolveRelatedQuery({ companyHitCount: companyHits.length, title });

  const jobs =
    plan.mode === "title-fallback"
      ? await fetchRelatedExcluding(jobId, { q: plan.fallbackQuery })
      : companyHits;

  const openCount = companyDomain ? await resolveCompanyOpenCount(companyDomain) : null;

  return { jobs, openCount };
}

/** Page size for the cached default browse — mirrors `PAGE` in
 *  jobs/page.tsx (currently 20). Not imported from there: that file is
 *  "use client" and this one is "use server," so the two stay independent
 *  constants by construction rather than a cross-runtime import. */
const DEFAULT_BROWSE_LIMIT = 20;

/**
 * Resolve a country ISO2 to the same `places` clause shape
 * `resolveLocationDefault` (lib/geo/ip-default.ts) would produce for it —
 * built straight from the bundled gazetteer, no corpus-value validation
 * (that step is a live Meilisearch facet-search call; skipping it is what
 * keeps this cheap enough to run outside the cache below on every request).
 * A country genuinely absent from the corpus just yields zero hits, same as
 * any other search with an obscure filter — not a failure.
 */
function placesForCountry(iso2: string): PlaceClause[] | undefined {
  const candidates = countryPlaceCandidates(iso2, loadGazetteer());
  return candidates?.length ? [{ any: candidates }] : undefined;
}

/**
 * The fixed "default browse" shape (2026-08-07 front-door reversal, product
 * decision: a zero-query visitor must see real jobs on first paint) — empty
 * query, the app's standing 30d posted-window default (`DEFAULT_URL_STATE`,
 * lib/jobs/url-state.ts), freshest-first, ghosts hidden (the first-screen
 * default), and the resolved country's postings when the corpus has any.
 *
 * Distinct from search-cache.ts's OWN "default browse" bookkeeping
 * (`isDefaultBrowseParams`/`DEFAULT_BROWSE_CACHE_KEY`) — that one caches the
 * fully unfiltered, no-window shape the pre-rule-§1 cold-visit browse used
 * to send before it was killed off for being the single most expensive query
 * the app issued; it survives today only as search.ts's own outage-fallback
 * key for other callers (e.g. MCP), untouched by this. This shape is bounded
 * by the 30d window, so it's cheap enough to serve fresh rather than only
 * as a degraded fallback.
 *
 * Cached 600s, keyed ONLY by the resolved `places` clause (i.e. by country —
 * `undefined` for "no country resolved," a single shared entry) — every real
 * user-typed search or filtered fetch stays on the uncached `searchJobsAction`
 * path above; this is the one fixed shape cheap enough to share across every
 * visitor from the same country instead of hitting the corpus per visitor.
 */
const getCachedDefaultBrowse = unstable_cache(
  async (places: PlaceClause[] | undefined): Promise<JobSearchResult & { meta?: SearchServeMeta }> =>
    runSearch(
      {
        postedBucket: "30d",
        hideGhosts: true,
        sort: "newest",
        limit: DEFAULT_BROWSE_LIMIT,
        offset: 0,
        withFacets: true,
        places,
      },
      {},
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
): Promise<JobSearchResult & { searchId: string; meta?: SearchServeMeta; defaultedLocation?: string }> {
  const searchId = randomUUID();
  const ip = suppressLocationDefault ? null : await getClientIp();
  const iso2 = ip ? await countryLookup(ip) : null;
  const places = iso2 ? placesForCountry(iso2) : undefined;
  try {
    const result = await getCachedDefaultBrowse(places);
    return { ...result, searchId, ...(places ? { defaultedLocation: iso2! } : {}) };
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
  async (iso2: string | null, bucketedCursorIso: string): Promise<number> => {
    const places = iso2 ? placesForCountry(iso2) : undefined;
    const result = await runSearch(
      { postedSinceMs: Date.parse(bucketedCursorIso), places, limit: 1, withFacets: false },
      {},
    );
    return result.total;
  },
  ["jobs-count-new-board"],
  { revalidate: 900 },
);

export async function countNewSinceAction(
  input: { scope: "board" } | { scope: "saved"; params: JobsUrlState },
  cursorIso: string,
): Promise<number> {
  // Same per-IP chokepoint as searchJobsAction/getRelatedJobsAction — a
  // count is an accelerant for a banner, never a primary result, so denial
  // is 0 (renders nothing) rather than an error the caller must special-case.
  const ip = await getClientIp();
  if (!allowSearchRequest(ip)) return 0;

  const bucketedCursor = bucketCursorToUtcDay(cursorIso);

  if (input.scope === "board") {
    const iso2 = ip ? await countryLookup(ip) : null;
    try {
      return await getCachedBoardCountNew(iso2, bucketedCursor);
    } catch (e) {
      console.error("[jobs-count-new] board scope transport error:", e);
      return 0;
    }
  }

  // Saved scope: the saved search's own filters (via the shared
  // `jobSearchParamsFromUrlState` mapping — also used by the digest's
  // per-saved-search fetch, lib/email/digest/collect.ts) plus the same
  // posted_ts cursor clause board scope uses above.
  const result = await runSearch(
    {
      ...jobSearchParamsFromUrlState(input.params, Date.parse(bucketedCursor)),
      limit: 1,
      withFacets: false,
    },
    { clientIp: ip, countryLookup },
  );
  return result.total;
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
  if (!searchId || !jobId || !Number.isFinite(rank) || rank < 0) return;
  const entry = buildJobOpenEntry(searchId, String(jobId).slice(0, 128), rank, Date.now());
  after(() => recordJobOpen(entry));
}

/** The corpus's last-updated timestamp, for the "last synced" trust stamp. */
export async function getJobsFreshnessAction(): Promise<string | null> {
  return getJobsLastUpdated();
}

/**
 * Whether the corpus can support the posted-date buckets. The rail and the
 * mobile chip hide the control when it can't, rather than offering a filter
 * that returns an empty board.
 */
export async function getPostedDateFilterSupportAction(): Promise<boolean | null> {
  return isPostedDateFilterSupported();
}

/**
 * Explore mode: ask the model for ADJACENT roles the candidate is positioned for
 * but might not search themselves. Inherits the login + credit gate from
 * `generateGenericJSON` — auth / out-of-credits surface as sentinel-prefixed
 * `error` strings the client routes to the AuthPopover (see lib/llm/sentinels).
 *
 * Inputs are user-controlled (resume-derived) and flow into an LLM prompt, so
 * they're length-capped to bound prompt size + injection surface.
 */
export async function suggestAdjacentRolesAction(input: {
  profession: string;
  skills: string[];
  seniority?: string | null;
}): Promise<{ titles?: string[]; error?: string }> {
  const profession = (input.profession ?? "").trim().slice(0, 120);
  const skills = (input.skills ?? [])
    .map((s) => String(s ?? "").trim().slice(0, 60))
    .filter(Boolean)
    .slice(0, 12);
  const seniority = (input.seniority ?? "").trim().slice(0, 20);

  if (!profession && skills.length === 0) {
    return { error: "Add a profession or skills to your resume to explore adjacent roles." };
  }

  const prompt = `You suggest ADJACENT career roles for a job seeker.

Current role: "${profession || "(not specified)"}"
${seniority ? `Seniority: ${seniority}` : ""}
Skills: ${skills.join(", ") || "(none listed)"}

Return 6 to 8 job titles that are ADJACENT or TANGENTIAL to this background —
roles the person is well-positioned for but might not search for themselves.
Favor lateral moves and reasonable stretches that reuse their skills. Avoid
exact synonyms of their current title, and avoid unrelated fields.

Return ONLY JSON, no prose:
{ "titles": ["Title 1", "Title 2", "Title 3", "Title 4", "Title 5", "Title 6"] }`;

  const result = await generateGenericJSON(prompt);

  // Sentinel-prefixed hard blocks (AUTH_REQUIRED / OUT_OF_CREDITS) arrive here
  // verbatim; pass them through so the client's sentinel UX fires.
  if (result?.error) return { error: result.error };

  const lowerProfession = profession.toLowerCase();
  const titles = (Array.isArray(result?.titles) ? result.titles : [])
    .map((t: unknown) => String(t ?? "").trim())
    .filter((t: string) => t.length > 0 && t.toLowerCase() !== lowerProfession)
    .filter((t: string, i: number, arr: string[]) => arr.findIndex((x) => x.toLowerCase() === t.toLowerCase()) === i)
    .slice(0, 8);

  if (titles.length === 0) return { error: "NO_SUGGESTIONS" };
  return { titles };
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
  return getJobById(id);
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
    );
    if (res.error) return { error: res.error };
    return { data: { id: res.data!.id } };
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

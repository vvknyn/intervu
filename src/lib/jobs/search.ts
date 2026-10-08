/**
 * Jobs search dispatcher. Picks a backend by environment, in priority order:
 *   1. Meilisearch (production)      — MEILISEARCH_HOST set.
 *   2. Snapshot-preview (dev / demo) — JOBS_PREVIEW_FROM_SNAPSHOT=1 + SUBSPACE_API_KEY.
 *   3. Unconfigured                  — returns an empty, honest "not connected yet" result.
 *
 * Server-only (touches server env + the Subspace client). Call via the
 * `@/actions/jobs` server actions from client components.
 */
import {
  fetchFacetSearch,
  fetchJobSuggestions,
  fetchJobsLastUpdated,
  fetchPostedDateFilterSupported,
  hasMeilisearch,
  LOCATION_FACET_FIELDS,
  probeCompanyMatch,
  searchMeili,
} from "./meilisearch";
import { previewEnabled, searchSnapshotPreview } from "./snapshot-preview";
import { SEARCH_UNAVAILABLE_MESSAGE } from "./result-state";
import { applyQueryUnderstanding, resolveLocationFacet, type LocationVocabulary } from "./query-understanding";
import { loadGazetteer } from "../geo/gazetteer";
import { createCorpusValueChecker } from "../geo/corpus-values";
import type { CountryLookup } from "../geo/ip-country";
import { applyLocationDefault } from "../geo/ip-default";
import { getDegradedServe, sharedLiveSearch, type SearchServeMeta } from "./search-cache";
import type { JobSearchParams, JobSearchResult, JobsBackendKind, JobSuggestions } from "./types";
export type { SearchServeMeta } from "./search-cache";

export function activeBackend(): JobsBackendKind {
  if (hasMeilisearch()) return "meilisearch";
  if (previewEnabled()) return "snapshot-preview";
  return "unconfigured";
}

export function getJobsBackendStatus(): {
  backend: JobsBackendKind;
  configured: boolean;
  note: string;
} {
  const backend = activeBackend();
  if (backend === "meilisearch") {
    return { backend, configured: true, note: "Meilisearch index" };
  }
  if (backend === "snapshot-preview") {
    return { backend, configured: true, note: "Snapshot preview (dev)" };
  }
  return {
    backend,
    configured: false,
    note:
      "Job search isn't connected yet. Set MEILISEARCH_HOST (production) or " +
      "JOBS_PREVIEW_FROM_SNAPSHOT=1 with SUBSPACE_API_KEY (dev preview).",
  };
}

/**
 * Place-resolution context for query understanding: the gazetteer (static,
 * bundled, indexed once per server instance — see lib/geo/gazetteer.ts) plus
 * a corpus-value checker that caches its own live Meilisearch lookups per
 * (field, value) (lib/geo/corpus-values.ts) — no bulk fetch to warm here,
 * unlike the old corpus-only vocabulary this replaced.
 *
 * Exported (Task 12 review fix) so `toolSearchJobs` (agent/tools.ts) can
 * resolve its own `location` filter through the SAME resolver `searchJobs`
 * below already uses for free-text queries, via `ToolDeps`, rather than a
 * second place-resolution path.
 */
const corpusChecker = createCorpusValueChecker(fetchFacetSearch);

export async function locationVocabulary(): Promise<LocationVocabulary> {
  return { gazetteer: loadGazetteer(), corpusChecker, companyProbe: probeCompanyMatch };
}

/**
 * The query-understanding step every entry point into jobs search must run
 * before raw params reach a backend: work-mode/place tokens parsed out of
 * free text (`applyQueryUnderstanding`), then the typed/picked location
 * facet resolved into `places` (`resolveLocationFacet`) — subdivision
 * expansion and remote-anywhere widening both live inside that resolution,
 * so anything that skips this function never sees either.
 *
 * Extracted (PR #479 round 2) so `/api/jobs/count` can call this exact
 * function instead of a second, drifted approximation of it — round 1's
 * defect: the count route built its filter straight off
 * `raw.facets.location_country`, never running this step, so a widening
 * applied here never reached the canary at all.
 *
 * `needsVocab`'s gate and the `raw.id` dead-link skip are unchanged by this
 * extraction: a single-id existence probe (jobs/page.tsx's dead-link check)
 * has no query text or location facet to resolve, so building the
 * gazetteer/corpus-checker vocabulary for it is pure waste.
 *
 * The IP-country default (`applyLocationDefault`, below) is deliberately
 * OUTSIDE this function — it's applied only by the browser-facing action
 * (`actions/jobs.ts`, via `searchJobs`'s `opts.clientIp`), never by an MCP
 * call or the count canary, both of which must reflect exactly what was
 * typed/picked, not a guess from request IP.
 */
export async function understandSearchParams(raw: JobSearchParams): Promise<JobSearchParams> {
  const needsVocab =
    !raw.id && Boolean((raw.q ?? "").trim() || LOCATION_FACET_FIELDS.some((f) => raw.facets?.[f]?.length));
  const vocab = needsVocab ? await locationVocabulary() : undefined;
  return vocab
    ? await resolveLocationFacet(await applyQueryUnderstanding(raw, vocab), vocab)
    : await applyQueryUnderstanding(raw, vocab);
}

export async function searchJobs(
  raw: JobSearchParams,
  // `countryLookup` is injected rather than built in here (unlike
  // `corpusChecker` above) because its real implementation
  // (createMmdbCountryLookup, lib/geo/ip-country.ts) statically pulls in
  // `maxmind` + `node:path` — Node built-ins this module can't afford a
  // hard dependency on: `searchJobs` also runs under `/co/[slug]`'s
  // `opengraph-image` route, which declares `runtime = "edge"` and has no
  // filesystem at all. Only `actions/jobs.ts` (always Node, never edge)
  // constructs and passes one; every other caller (MCP, the OG route)
  // simply omits it and the IP-default step below no-ops.
  opts?: { clientIp?: string; countryLookup?: CountryLookup },
): Promise<
  JobSearchResult & {
    meta?: SearchServeMeta;
    defaultedLocation?: string;
    /** See `LocationDefaultApplication.remoteAnywhere` (ip-default.ts) — same
     *  gate/lifecycle as `defaultedLocation`, so it always travels with it
     *  through every return point below. */
    remoteAnywhere?: boolean;
    unmatchedPlaceMentions?: string[];
  }
> {
  // Vocabulary is only relevant when there's something to resolve — query
  // text, or a location facet (`resolveLocationFacet`): the typed
  // `location_country` box, or a city/state value picked from the typeahead.
  // `LOCATION_FACET_FIELDS` is the same single source of truth
  // `resolveLocationFacet` itself reads, so a picked-only search (no query
  // text, no country) can't silently skip resolution and leak an
  // unconverted facet into `buildFilter`'s generic AND-across-keys loop. The
  // dead-link id probe and plain browses skip the lookup entirely.
  const understood = await understandSearchParams(raw);

  // IP country default — last in the understanding pipeline, and only when
  // NOTHING else already said where to search: not a typed/MCP place, not
  // an explicit location facet, not the suppressed-default override.
  // `opts.clientIp`/`countryLookup` are only ever passed by the
  // browser-facing action (actions/jobs.ts); every other caller leaves them
  // out, so an agent's search (MCP) is never silently narrowed by a box's
  // own egress IP, and this step is a no-op. See lib/geo/ip-default.ts —
  // `applyLocationDefault` is the whole decision, unit-tested on its own.
  //
  // `defaultedLocation` is REQUEST-scoped: it describes how THIS query was
  // interpreted, not what the backend returned. That's exactly why it must
  // survive a backend failure below (degraded cache / unavailable) — the
  // interpretation is still true even when Meilisearch itself is down. The
  // one place it must NOT be claimed is over a cached DEFAULT-BROWSE result
  // (see resolveDegradedServe in search-cache.ts), because that response
  // body is unfiltered and asserting a location over it would lie about
  // what's actually being shown.
  //
  // `unmatchedPlaceMentions` (resolveLocationFacet, query-understanding.ts) is
  // the same kind of REQUEST-scoped fact — it describes what got dropped from
  // THIS query's typed location text — so it's threaded through the exact
  // same return points, for the exact same reasons, below.
  const { params: p, defaultedLocation, remoteAnywhere } = await applyLocationDefault(
    understood,
    opts?.clientIp,
    opts?.countryLookup,
    locationVocabulary,
  );

  const backend = activeBackend();
  try {
    // `effectiveQ` is spread on here rather than returned by the backends
    // themselves — both already compute `p.q` internally (`buildSearchBody`,
    // the snapshot filter pass), so this is the one place the RESIDUAL query
    // (place/work-mode tokens already stripped by `applyQueryUnderstanding`
    // above) becomes part of the public result shape, without mutating
    // either backend's own return value.
    if (backend === "meilisearch") {
      // Identical searches share one call, and a success is remembered as the
      // last-good response for its exact query/filter shape (and, if it's the
      // default browse, as the outage fallback too) — see search-cache.ts.
      // Only the success path ever teaches the cache.
      const result = { ...(await sharedLiveSearch(p, () => searchMeili(p))), effectiveQ: p.q ?? "" };
      return {
        ...result,
        meta: { degraded: false, servedFrom: "live" },
        ...(defaultedLocation && { defaultedLocation, remoteAnywhere }),
        ...(p.unmatchedPlaceMentions && { unmatchedPlaceMentions: p.unmatchedPlaceMentions }),
      };
    }
    if (backend === "snapshot-preview") {
      return {
        ...(await searchSnapshotPreview(p)),
        effectiveQ: p.q ?? "",
        ...(defaultedLocation && { defaultedLocation, remoteAnywhere }),
        ...(p.unmatchedPlaceMentions && { unmatchedPlaceMentions: p.unmatchedPlaceMentions }),
      };
    }
  } catch (e) {
    // The raw error goes to server logs only — messages like Next's RSC
    // digest text are internals, not copy a job seeker should ever read.
    console.error("[jobs-search] backend error:", e);
    if (backend === "meilisearch") {
      // Meili's own bounded retry (meiliFetch, meilisearch.ts) already ran
      // and still failed — this is a real outage, not a blip. Serve the
      // last-good response for this exact request, or (for a plain default
      // browse only) the default-browse fallback, before giving up. A query
      // or filter never gets another request's rows: it falls through to
      // the unavailable result below. Fields are returned exactly as cached
      // (never re-stamped with the CURRENT request's query) so a
      // default-browse fallback never lies about what it's showing.
      const degraded = getDegradedServe(p);
      if (degraded) {
        return {
          ...degraded.result,
          meta: { degraded: true, servedFrom: "cache", cachedAtMs: degraded.cachedAtMs },
          // Only an "exact" hit was cached under THIS request's own
          // (already location-filtered) key — claiming the default over it
          // is true. A "default-browse" hit is the unfiltered fallback; see
          // the comment on `defaultedLocation`'s computation above for why
          // it must not be stamped there. Same reasoning for
          // `unmatchedPlaceMentions`.
          ...(degraded.servedKey === "exact" && defaultedLocation && { defaultedLocation, remoteAnywhere }),
          ...(degraded.servedKey === "exact" &&
            p.unmatchedPlaceMentions && { unmatchedPlaceMentions: p.unmatchedPlaceMentions }),
        };
      }
    }
    // Zero hits either way, so there's nothing for a location chip to
    // misrepresent — and the field describes how we interpreted the
    // REQUEST, which is still true with the backend down.
    return {
      hits: [],
      total: 0,
      backend,
      configured: true,
      unavailable: true,
      note: SEARCH_UNAVAILABLE_MESSAGE,
      ...(defaultedLocation && { defaultedLocation, remoteAnywhere }),
      ...(p.unmatchedPlaceMentions && { unmatchedPlaceMentions: p.unmatchedPlaceMentions }),
    };
  }
  // Config-error state (no backend configured at all), not a search
  // outcome — deliberately does NOT carry `defaultedLocation`. This isn't
  // a repeat of the dropped-field bug above: there's no result of any
  // kind being served here for a location chip to annotate, just an
  // operator-facing "search isn't set up" note.
  return {
    hits: [],
    total: 0,
    backend: "unconfigured",
    configured: false,
    note: getJobsBackendStatus().note,
  };
}

/** The last-updated timestamp of the rows `p` matches, for the "last synced"
 *  trust stamp — `p` omitted means the whole corpus. Meilisearch-only for now. */
export async function getJobsLastUpdated(p: JobSearchParams = {}): Promise<string | null> {
  if (activeBackend() === "meilisearch") return fetchJobsLastUpdated(p);
  return null;
}

/**
 * Can the corpus support age-bucket filtering? Only the Meilisearch backend
 * range-filters `posted_ts`; the snapshot preview holds an in-memory slice
 * with no filter engine, so it answers "no" rather than offering a control
 * that silently does nothing.
 */
export async function isPostedDateFilterSupported(): Promise<boolean | null> {
  if (activeBackend() !== "meilisearch") return false;
  // Two whole-corpus counts per call, and the default browse, the count
  // route and the page's own probe all ask on every visit. The answer moves
  // only as fast as the corpus does, so it is kept for POSTED_DATE_SUPPORT_TTL_MS
  // and concurrent askers share one probe. An unknown answer (null) is not kept.
  const now = Date.now();
  if (postedDateSupport.value !== null && now - postedDateSupport.atMs < POSTED_DATE_SUPPORT_TTL_MS) {
    return postedDateSupport.value;
  }
  postedDateSupport.pending ??= fetchPostedDateFilterSupported()
    .then((value) => {
      if (value !== null) Object.assign(postedDateSupport, { value, atMs: Date.now() });
      return value;
    })
    .finally(() => {
      postedDateSupport.pending = null;
    });
  return postedDateSupport.pending;
}

const POSTED_DATE_SUPPORT_TTL_MS = 10 * 60_000;
const postedDateSupport: { value: boolean | null; atMs: number; pending: Promise<boolean | null> | null } = {
  value: null,
  atMs: 0,
  pending: null,
};

export function resetPostedDateSupportCacheForTests(): void {
  Object.assign(postedDateSupport, { value: null, atMs: 0, pending: null });
}

/**
 * Typeahead dispatcher (Task 9): title/company suggestions for the search
 * box. Meilisearch-only — the snapshot-preview backend has no search
 * endpoint of its own to suggest from, so it degrades to empty rather than
 * scanning its in-memory slice. Never throws.
 */
export async function suggestJobs(q: string): Promise<JobSuggestions> {
  try {
    if (activeBackend() === "meilisearch") return await fetchJobSuggestions(q);
  } catch {
    // fall through to empty — suggestions must never surface an error
  }
  return { titles: [], companies: [] };
}

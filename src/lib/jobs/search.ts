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
import { cacheSearchResult, getDegradedServe, type SearchServeMeta } from "./search-cache";
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
): Promise<JobSearchResult & { meta?: SearchServeMeta; defaultedLocation?: string }> {
  // Vocabulary is only relevant when there's something to resolve — query
  // text, or the board's typed location facet (`resolveLocationFacet`). The
  // dead-link id probe and plain browses skip the lookup entirely.
  const needsVocab = !raw.id && Boolean((raw.q ?? "").trim() || raw.facets?.location_country?.length);
  const vocab = needsVocab ? await locationVocabulary() : undefined;
  const understood = vocab
    ? await resolveLocationFacet(await applyQueryUnderstanding(raw, vocab), vocab)
    : await applyQueryUnderstanding(raw, vocab);

  // IP country default — last in the understanding pipeline, and only when
  // NOTHING else already said where to search: not a typed/MCP place, not
  // an explicit location facet, not the suppressed-default override.
  // `opts.clientIp`/`countryLookup` are only ever passed by the
  // browser-facing action (actions/jobs.ts); every other caller leaves them
  // out, so an agent's search (MCP) is never silently narrowed by a box's
  // own egress IP, and this step is a no-op. See lib/geo/ip-default.ts —
  // `applyLocationDefault` is the whole decision, unit-tested on its own.
  const { params: p, defaultedLocation } = await applyLocationDefault(
    understood,
    opts?.clientIp,
    opts?.countryLookup,
    async () => vocab ?? locationVocabulary(),
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
      const result = { ...(await searchMeili(p)), effectiveQ: p.q ?? "" };
      // Remember this as the last-good response for its exact query/filter
      // shape (and, if it's the default browse, as the outage fallback too)
      // — see search-cache.ts. Only the success path ever teaches the cache.
      cacheSearchResult(p, result);
      return { ...result, meta: { degraded: false, servedFrom: "live" }, ...(defaultedLocation && { defaultedLocation }) };
    }
    if (backend === "snapshot-preview") {
      return { ...(await searchSnapshotPreview(p)), effectiveQ: p.q ?? "", ...(defaultedLocation && { defaultedLocation }) };
    }
  } catch (e) {
    // The raw error goes to server logs only — messages like Next's RSC
    // digest text are internals, not copy a job seeker should ever read.
    console.error("[jobs-search] backend error:", e);
    if (backend === "meilisearch") {
      // Meili's own bounded retry (meiliFetch, meilisearch.ts) already ran
      // and still failed — this is a real outage, not a blip. Serve the
      // last-good response for this exact request, or the default-browse
      // fallback, before giving up. Fields are returned exactly as cached
      // (never re-stamped with the CURRENT request's query) so a
      // default-browse fallback never lies about what it's showing.
      const degraded = getDegradedServe(p);
      if (degraded) {
        return {
          ...degraded.result,
          meta: { degraded: true, servedFrom: "cache", cachedAtMs: degraded.cachedAtMs },
        };
      }
    }
    return {
      hits: [],
      total: 0,
      backend,
      configured: true,
      unavailable: true,
      note: SEARCH_UNAVAILABLE_MESSAGE,
    };
  }
  return {
    hits: [],
    total: 0,
    backend: "unconfigured",
    configured: false,
    note: getJobsBackendStatus().note,
  };
}

/** The corpus's last-updated timestamp, for the "last synced" trust stamp. Meilisearch-only for now. */
export async function getJobsLastUpdated(): Promise<string | null> {
  if (activeBackend() === "meilisearch") return fetchJobsLastUpdated();
  return null;
}

/**
 * Can the corpus support age-bucket filtering? Only the Meilisearch backend
 * range-filters `posted_ts`; the snapshot preview holds an in-memory slice
 * with no filter engine, so it answers "no" rather than offering a control
 * that silently does nothing.
 */
export async function isPostedDateFilterSupported(): Promise<boolean | null> {
  if (activeBackend() === "meilisearch") return fetchPostedDateFilterSupported();
  return false;
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

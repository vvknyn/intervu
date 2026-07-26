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
  fetchJobSuggestions,
  fetchJobsLastUpdated,
  fetchLocationFacetDistributions,
  fetchPostedDateFilterSupported,
  hasMeilisearch,
  searchMeili,
} from "./meilisearch";
import { previewEnabled, searchSnapshotPreview } from "./snapshot-preview";
import { SEARCH_UNAVAILABLE_MESSAGE } from "./result-state";
import {
  applyQueryUnderstanding,
  buildLocationVocabulary,
  type LocationVocabulary,
} from "./query-understanding";
import type { JobSearchParams, JobSearchResult, JobsBackendKind, JobSuggestions } from "./types";

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
 * Corpus-derived place vocabulary for query understanding, cached per server
 * instance. Stale-while-revalidate: once any vocabulary exists, searches use
 * it immediately and a refresh runs behind them — the ONLY search that ever
 * waits on the vocabulary fetch is a cold instance's very first one, and a
 * failed fetch yields an empty vocabulary (place parsing just doesn't happen)
 * that retries on a short leash rather than caching the failure for an hour.
 */
const VOCAB_TTL_MS = 60 * 60 * 1000;
const VOCAB_RETRY_MS = 60 * 1000;
let vocabCache: { vocab: LocationVocabulary; at: number } | null = null;
let vocabInFlight: Promise<LocationVocabulary> | null = null;

async function locationVocabulary(): Promise<LocationVocabulary> {
  const ttl = vocabCache && vocabCache.vocab.byText.size > 0 ? VOCAB_TTL_MS : VOCAB_RETRY_MS;
  if (vocabCache && Date.now() - vocabCache.at < ttl) return vocabCache.vocab;
  if (!vocabInFlight) {
    vocabInFlight = fetchLocationFacetDistributions()
      .then((d) => {
        vocabCache = { vocab: buildLocationVocabulary(d), at: Date.now() };
        return vocabCache.vocab;
      })
      .finally(() => {
        vocabInFlight = null;
      });
  }
  return vocabCache ? vocabCache.vocab : vocabInFlight;
}

export async function searchJobs(raw: JobSearchParams): Promise<JobSearchResult> {
  // Vocabulary is only relevant when there's query text to parse — the
  // dead-link id probe and plain browses skip the lookup entirely.
  const vocab = (raw.q ?? "").trim() && !raw.id ? await locationVocabulary() : undefined;
  const p = applyQueryUnderstanding(raw, vocab);
  const backend = activeBackend();
  try {
    if (backend === "meilisearch") return await searchMeili(p);
    if (backend === "snapshot-preview") return await searchSnapshotPreview(p);
  } catch (e) {
    // The raw error goes to server logs only — messages like Next's RSC
    // digest text are internals, not copy a job seeker should ever read.
    console.error("[jobs-search] backend error:", e);
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

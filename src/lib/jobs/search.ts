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
  fetchPostedDateFilterSupported,
  hasMeilisearch,
  searchMeili,
} from "./meilisearch";
import { previewEnabled, searchSnapshotPreview } from "./snapshot-preview";
import { applyQueryUnderstanding } from "./query-understanding";
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

export async function searchJobs(raw: JobSearchParams): Promise<JobSearchResult> {
  const p = applyQueryUnderstanding(raw);
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
      note: "The search index didn't respond. This usually clears within a minute — try again.",
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
export async function isPostedDateFilterSupported(): Promise<boolean> {
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

/**
 * Jobs search dispatcher. Picks a backend by environment, in priority order:
 *   1. Meilisearch (production)      — MEILISEARCH_HOST set.
 *   2. Snapshot-preview (dev / demo) — JOBS_PREVIEW_FROM_SNAPSHOT=1 + SUBSPACE_API_KEY.
 *   3. Unconfigured                  — returns an empty, honest "not connected yet" result.
 *
 * Server-only (touches server env + the Subspace client). Call via the
 * `@/actions/jobs` server actions from client components.
 */
import { fetchJobsLastUpdated, hasMeilisearch, searchMeili } from "./meilisearch";
import { previewEnabled, searchSnapshotPreview } from "./snapshot-preview";
import type { JobSearchParams, JobSearchResult, JobsBackendKind } from "./types";

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

export async function searchJobs(p: JobSearchParams): Promise<JobSearchResult> {
  const backend = activeBackend();
  try {
    if (backend === "meilisearch") return await searchMeili(p);
    if (backend === "snapshot-preview") return await searchSnapshotPreview(p);
  } catch (e) {
    return {
      hits: [],
      total: 0,
      backend,
      configured: true,
      note: `Job search is temporarily unavailable: ${e instanceof Error ? e.message : String(e)}`,
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

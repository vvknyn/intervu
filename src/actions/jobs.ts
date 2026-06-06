"use server";

import { createApplication } from "@/actions/application";
import { getJobsBackendStatus, searchJobs as runSearch } from "@/lib/jobs/search";
import type { JobSearchParams, JobSearchResult, JobsBackendKind } from "@/lib/jobs/types";

/** Search the jobs corpus (dispatches to whichever backend is configured). */
export async function searchJobsAction(params: JobSearchParams): Promise<JobSearchResult> {
  return runSearch(params);
}

/** Report which search backend is live, for the UI's connected/empty states. */
export async function jobsBackendStatusAction(): Promise<{
  backend: JobsBackendKind;
  configured: boolean;
  note: string;
}> {
  return getJobsBackendStatus();
}

/**
 * Track a job the user is applying to — the "apply → track" step of the loop.
 * Creates an application row (status "applied") in the user's tracker. Applying
 * itself is a deep-link out to the posting; this records that they did.
 */
export async function markJobAppliedAction(input: {
  company: string;
  title: string;
  applyUrl: string;
}): Promise<{ data?: { id: string }; error?: string }> {
  const res = await createApplication({
    company_name: input.company || "Unknown Company",
    position: input.title || "Unknown Position",
    job_url: input.applyUrl || undefined,
    status: "applied",
    applied_at: new Date().toISOString(),
  });
  if (res.error) return { error: res.error };
  const id = (res.data as { id?: string } | undefined)?.id ?? "";
  return { data: { id } };
}

/**
 * The jobs list search from the browser: a fetch to POST /api/jobs/search,
 * not a Server Action call, so it never holds Next's one-at-a-time action
 * queue (see that route for why). Resolves to exactly what
 * `searchJobsAction` returns, and rejects on a non-2xx answer or a network
 * failure as the action call did, so callers' catch paths are unchanged.
 */
import type { searchJobsAction } from "@/actions/jobs";
import type { JobSearchParams } from "@/lib/jobs/types";

export type JobsSearchResponse = Awaited<ReturnType<typeof searchJobsAction>>;

export async function searchJobs(params: JobSearchParams): Promise<JobsSearchResponse> {
    const res = await fetch("/api/jobs/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        credentials: "same-origin",
        cache: "no-store",
    });
    if (!res.ok) throw new Error(`Search failed (${res.status})`);
    return (await res.json()) as JobsSearchResponse;
}

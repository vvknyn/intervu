/**
 * Server-only: fetches new roles matching a saved search via `searchJobs`
 * directly — same shape as `lib/follows/list-new-roles.ts`'s
 * `listNewRolesForFollows`, and deliberately NOT through
 * `countNewSinceAction`/`searchJobsAction` (actions/jobs.ts): those wrap
 * `searchJobs` with `getClientIp()`-based rate limiting, which assumes a
 * live HTTP request and throws/misbehaves outside one (a server-side digest
 * run has no client IP). The digest calls this instead, the same way the
 * follows digest section already calls `listNewRolesForFollows` instead of
 * a Server Action.
 */
import { searchJobs } from "./search";
import { jobSearchParamsFromUrlState, type JobsUrlState } from "./url-state";
import type { JobSearchParams, JobSearchResult, PublicJob } from "./types";
import { isUnavailableJobsResult } from "./result-state";

type SearchFn = (params: JobSearchParams) => Promise<JobSearchResult>;

/** How many hits to pull per saved search — same cap
 *  `JOBS_FETCHED_PER_FOLLOW_DOMAIN` uses for a followed company, so a
 *  single very-active search can't crowd out the digest's I/O budget. */
export const JOBS_FETCHED_PER_SAVED_SEARCH = 10;

export async function listNewRolesForSavedSearch(
  sinceIso: string,
  state: JobsUrlState,
  search: SearchFn = searchJobs,
): Promise<PublicJob[]> {
  const sinceMs = Date.parse(sinceIso);
  if (Number.isNaN(sinceMs)) return [];

  const result = await search({
    ...jobSearchParamsFromUrlState(state, sinceMs),
    limit: JOBS_FETCHED_PER_SAVED_SEARCH,
    offset: 0,
    sort: "newest",
    withFacets: false,
  });

  return isUnavailableJobsResult(result) ? [] : result.hits;
}

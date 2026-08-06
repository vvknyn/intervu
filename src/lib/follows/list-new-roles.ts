/**
 * Server-only: fetches new roles at followed companies via `searchJobs`
 * (Meilisearch). Split out of alerts.ts (which stays client-safe — see its
 * doc comment) so no client component's import graph ever reaches
 * `@/lib/jobs/search`.
 */
import { isUnavailableJobsResult } from "@/lib/jobs/result-state";
import { searchJobs } from "@/lib/jobs/search";
import type { JobSearchParams, JobSearchResult, PublicJob } from "@/lib/jobs/types";
import {
  groupFollowAlertsByDomain,
  JOBS_FETCHED_PER_FOLLOW_DOMAIN,
  MAX_FOLLOW_ALERT_DOMAINS,
  type FollowAlertGroup,
} from "./alerts";
import type { FollowedCompany } from "./types";

type SearchFn = (params: JobSearchParams) => Promise<JobSearchResult>;

export async function listNewRolesForFollows(
  sinceIso: string,
  follows: FollowedCompany[],
  search: SearchFn = searchJobs,
): Promise<FollowAlertGroup[]> {
  if (follows.length === 0) return [];

  const capped = follows.slice(0, MAX_FOLLOW_ALERT_DOMAINS);
  const results = await Promise.all(
    capped.map((f) =>
      search({
        companyDomain: f.domain,
        limit: JOBS_FETCHED_PER_FOLLOW_DOMAIN,
        offset: 0,
        hideGhosts: true,
        sort: "newest",
      }),
    ),
  );

  const hits: PublicJob[] = [];
  for (const result of results) {
    if (!isUnavailableJobsResult(result)) hits.push(...result.hits);
  }

  return groupFollowAlertsByDomain(hits, capped, sinceIso).filter((g) => g.jobs.length > 0);
}

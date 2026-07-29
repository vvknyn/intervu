import { derivePostedTs } from "@/lib/jobs/meilisearch";
import { isUnavailableJobsResult } from "@/lib/jobs/result-state";
import { searchJobs } from "@/lib/jobs/search";
import type { JobSearchParams, JobSearchResult, PublicJob } from "@/lib/jobs/types";
import type { FollowedCompany } from "./types";

export const MAX_FOLLOW_ALERT_DOMAINS = 20;
export const JOBS_FETCHED_PER_FOLLOW_DOMAIN = 10;

export type FollowAlertGroup = {
  domain: string;
  displayName: string;
  jobs: PublicJob[];
};

type SearchFn = (params: JobSearchParams) => Promise<JobSearchResult>;

export function jobPostedMs(job: PublicJob): number | null {
  if (typeof job.posted_ts === "number") return job.posted_ts;
  return derivePostedTs(job);
}

/** Pure: keep jobs at followed domains first seen after `sinceIso`, grouped by domain. */
export function groupFollowAlertsByDomain(
  jobs: PublicJob[],
  follows: Pick<FollowedCompany, "domain" | "displayName">[],
  sinceIso: string,
): FollowAlertGroup[] {
  const sinceMs = Date.parse(sinceIso);
  if (Number.isNaN(sinceMs)) return [];

  const followByDomain = new Map(
    follows.map((f) => [f.domain.trim().toLowerCase(), f.displayName.trim() || f.domain]),
  );
  const byDomain = new Map<string, PublicJob[]>();

  for (const job of jobs) {
    const domain = job.company_domain?.trim().toLowerCase();
    if (!domain || !followByDomain.has(domain)) continue;

    const postedMs = jobPostedMs(job);
    if (postedMs == null || postedMs <= sinceMs) continue;

    const list = byDomain.get(domain) ?? [];
    list.push(job);
    byDomain.set(domain, list);
  }

  const groups: FollowAlertGroup[] = [];
  for (const [domain, domainJobs] of byDomain) {
    domainJobs.sort((a, b) => (jobPostedMs(b) ?? 0) - (jobPostedMs(a) ?? 0));
    groups.push({
      domain,
      displayName: followByDomain.get(domain) ?? domain,
      jobs: domainJobs,
    });
  }

  return groups.sort((a, b) => {
    const aMax = jobPostedMs(a.jobs[0]!) ?? 0;
    const bMax = jobPostedMs(b.jobs[0]!) ?? 0;
    return bMax - aMax;
  });
}

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

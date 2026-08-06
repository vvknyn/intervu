import { decodeSlug, domainToSlug, getBoardsForDomain, slugToDomain } from "@/lib/boards/slug";
import type { CompanyPageData } from "@/lib/companies/types";
import { isUnavailableJobsResult, SEARCH_UNAVAILABLE_MESSAGE } from "@/lib/jobs/result-state";
import { searchJobs } from "@/lib/jobs/search";
import type { JobSearchParams, JobSearchResult, PublicJob } from "@/lib/jobs/types";

type SearchFn = (params: JobSearchParams) => Promise<JobSearchResult>;

function displayNameFromDomain(domain: string): string {
  const label = domain.split(".")[0] ?? domain;
  return label.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function ghostFlaggedPct(jobs: PublicJob[]): number | null {
  if (jobs.length === 0) return null;
  const flagged = jobs.filter((j) => j.ghost_badge === "likely_ghost").length;
  return Math.round((flagged / jobs.length) * 100);
}

export async function getCompanyPageData(
  slug: string,
  search: SearchFn = searchJobs,
): Promise<CompanyPageData | null> {
  const allowlisted = slugToDomain(slug);
  const domain = allowlisted ?? decodeSlug(slug);
  if (!domain) return null;

  const result = await search({
    companyDomain: domain,
    limit: 200,
    hideGhosts: false,
  });
  // A failed search (bad/unfilterable index config, live outage) must never
  // be read as "this company has zero jobs" — that's how the animana--com
  // 400 became a false 404. Distinguish via the same `unavailable` signal
  // every other searchJobs caller already checks (hot-list.ts, follows/
  // alerts.ts, jobs/page.tsx) and propagate it as a throw, so Next renders
  // its error boundary/500 instead of a confident "not found."
  if (isUnavailableJobsResult(result)) {
    throw new Error(result.note ?? SEARCH_UNAVAILABLE_MESSAGE);
  }
  const jobs = result.hits;
  const boards = getBoardsForDomain(domain);

  if (jobs.length === 0 && boards.length === 0) return null;

  const first = jobs[0];
  const openCount =
    typeof first?.company_open_count === "number" ? first.company_open_count : jobs.length;

  return {
    domain,
    slug: domainToSlug(domain),
    name: first?.company?.trim() || displayNameFromDomain(domain),
    // No product tagline in the index yet — do not misuse company_stage as one.
    oneLiner: null,
    stage: first?.company_stage?.trim() || null,
    opened90d: first?.company_opened_90d ?? null,
    closed90d: first?.company_closed_90d ?? null,
    openCount,
    ghostFlaggedPct: ghostFlaggedPct(jobs),
    jobs,
    boards,
  };
}

import { decodeSlug, domainToSlug, getBoardsForDomain, slugToDomain } from "@/lib/boards/slug";
import { resolveCompanyName } from "@/lib/companies/company-name";
import { resolveOpenCount } from "@/lib/companies/open-count";
import type { CompanyPageData } from "@/lib/companies/types";
import { isUnavailableJobsResult, SEARCH_UNAVAILABLE_MESSAGE } from "@/lib/jobs/result-state";
import { searchJobs } from "@/lib/jobs/search";
import type { JobSearchParams, JobSearchResult, PublicJob } from "@/lib/jobs/types";

type SearchFn = (params: JobSearchParams) => Promise<JobSearchResult>;

/**
 * Hit window for the roles list. Named and exported because it is also the
 * saturation threshold `resolveOpenCount` needs — the count must know how
 * big the window was to know whether it filled up. It is NOT the count: that
 * conflation is exactly the bug this replaced.
 */
export const COMPANY_JOBS_FETCH_LIMIT = 200;

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
    limit: COMPANY_JOBS_FETCH_LIMIT,
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
  const name = resolveCompanyName(jobs, domain);
  const openCount = resolveOpenCount(result, jobs.length, COMPANY_JOBS_FETCH_LIMIT);
  // The `company_*` per-employer aggregates are NOT in the live document
  // schema (verified 2026-08-11: no company_open_count / company_opened_90d /
  // company_closed_90d / company_stage on any doc), so these read as null on
  // every row today. Kept as the seam for when the aggregate sync lands —
  // `hasTrackRecord` is what stops the page drawing a history out of nulls in
  // the meantime. `company_open_count` is deliberately NOT consulted for the
  // count any more: it was absent, so the old expression fell through to the
  // hit-window length on every single request.
  const opened90d = first?.company_opened_90d ?? null;
  const closed90d = first?.company_closed_90d ?? null;

  return {
    domain,
    slug: domainToSlug(domain),
    name: name.value,
    nameSource: name.source,
    // No product tagline in the index yet — do not misuse company_stage as one.
    oneLiner: null,
    stage: first?.company_stage?.trim() || null,
    opened90d,
    closed90d,
    hasTrackRecord: opened90d !== null && closed90d !== null,
    openCount: openCount.value,
    openCountIsLowerBound: openCount.isLowerBound,
    ghostFlaggedPct: ghostFlaggedPct(jobs),
    jobs,
    boards,
  };
}

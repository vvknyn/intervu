import { domainToSlug } from "@/lib/boards/slug";
import { searchJobs } from "@/lib/jobs/search";
import { isUnavailableJobsResult, SEARCH_UNAVAILABLE_MESSAGE } from "@/lib/jobs/result-state";
import type { JobSearchParams, JobSearchResult, PublicJob } from "@/lib/jobs/types";

/** Elite board has ~443 domains; paginate in 500-hit pages up to this cap. */
export const ELITE_JOBS_PAGE_SIZE = 500;
export const ELITE_JOBS_MAX_HITS = 1500;

export type HotCompaniesListResult =
  | { status: "ok"; companies: HotCompanyRow[] }
  | { status: "unavailable"; message: string };

export type HotCompanyRow = {
  domain: string;
  slug: string;
  name: string;
  oneLiner: string | null;
  opened90d: number | null;
  openCount: number;
};

function displayNameFromDomain(domain: string): string {
  const label = domain.split(".")[0] ?? domain;
  return label.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Rank by observed openings in 90d; rows without `opened90d` are excluded. */
export function rankHotCompanies(rows: HotCompanyRow[]): HotCompanyRow[] {
  return [...rows]
    .filter((r): r is HotCompanyRow & { opened90d: number } => typeof r.opened90d === "number")
    .sort((a, b) => b.opened90d - a.opened90d);
}

export function aggregateHotCompaniesFromJobs(jobs: PublicJob[]): HotCompanyRow[] {
  const byDomain = new Map<string, PublicJob[]>();
  for (const job of jobs) {
    const domain = job.company_domain?.trim().toLowerCase();
    if (!domain) continue;
    const list = byDomain.get(domain) ?? [];
    list.push(job);
    byDomain.set(domain, list);
  }

  const rows: HotCompanyRow[] = [];
  for (const [domain, domainJobs] of byDomain) {
    const first = domainJobs[0]!;
    rows.push({
      domain,
      slug: domainToSlug(domain),
      name: first.company?.trim() || displayNameFromDomain(domain),
      oneLiner: first.company_stage?.trim() || null,
      opened90d: typeof first.company_opened_90d === "number" ? first.company_opened_90d : null,
      openCount:
        typeof first.company_open_count === "number" ? first.company_open_count : domainJobs.length,
    });
  }
  return rows;
}

type SearchFn = (params: JobSearchParams) => Promise<JobSearchResult>;

export async function fetchEliteBoardJobHits(
  search: SearchFn = searchJobs,
): Promise<{ hits: PublicJob[] } | { unavailable: true; message: string }> {
  const hits: PublicJob[] = [];
  let offset = 0;

  while (hits.length < ELITE_JOBS_MAX_HITS) {
    const limit = Math.min(ELITE_JOBS_PAGE_SIZE, ELITE_JOBS_MAX_HITS - hits.length);
    const result = await search({ board: "elite", limit, offset, hideGhosts: false });

    if (isUnavailableJobsResult(result)) {
      return { unavailable: true, message: result.note ?? SEARCH_UNAVAILABLE_MESSAGE };
    }

    hits.push(...result.hits);
    if (result.hits.length < limit) break;
    offset += result.hits.length;
  }

  return { hits };
}

function orderHotCompanyRows(rows: HotCompanyRow[]): HotCompanyRow[] {
  const ranked = rankHotCompanies(rows);
  const rankedDomains = new Set(ranked.map((r) => r.domain));
  const rest = rows
    .filter((r) => !rankedDomains.has(r.domain))
    .sort((a, b) => b.openCount - a.openCount);
  return [...ranked, ...rest];
}

export async function getHotCompaniesList(
  search: SearchFn = searchJobs,
): Promise<HotCompaniesListResult> {
  const fetched = await fetchEliteBoardJobHits(search);
  if ("unavailable" in fetched) {
    return { status: "unavailable", message: fetched.message };
  }

  return { status: "ok", companies: orderHotCompanyRows(aggregateHotCompaniesFromJobs(fetched.hits)) };
}

import { domainToSlug } from "@/lib/boards/slug";
import { searchJobs } from "@/lib/jobs/search";
import type { PublicJob } from "@/lib/jobs/types";

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

export async function getHotCompaniesList(): Promise<HotCompanyRow[]> {
  const result = await searchJobs({
    board: "elite",
    limit: 1000,
    hideGhosts: false,
  });
  const rows = aggregateHotCompaniesFromJobs(result.hits);
  const ranked = rankHotCompanies(rows);
  const rankedDomains = new Set(ranked.map((r) => r.domain));
  const rest = rows
    .filter((r) => !rankedDomains.has(r.domain))
    .sort((a, b) => b.openCount - a.openCount);
  return [...ranked, ...rest];
}

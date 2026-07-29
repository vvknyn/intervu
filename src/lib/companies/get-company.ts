import { decodeSlug, domainToSlug, getBoardsForDomain, slugToDomain } from "@/lib/boards/slug";
import type { CompanyPageData } from "@/lib/companies/types";
import { searchJobs } from "@/lib/jobs/search";
import type { PublicJob } from "@/lib/jobs/types";

function displayNameFromDomain(domain: string): string {
  const label = domain.split(".")[0] ?? domain;
  return label.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function ghostFlaggedPct(jobs: PublicJob[]): number | null {
  if (jobs.length === 0) return null;
  const flagged = jobs.filter((j) => j.ghost_badge === "likely_ghost").length;
  return Math.round((flagged / jobs.length) * 100);
}

export async function getCompanyPageData(slug: string): Promise<CompanyPageData | null> {
  const allowlisted = slugToDomain(slug);
  const domain = allowlisted ?? decodeSlug(slug);
  if (!domain) return null;

  const result = await searchJobs({
    companyDomain: domain,
    limit: 200,
    hideGhosts: false,
  });
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
    oneLiner: first?.company_stage?.trim() || null,
    opened90d: first?.company_opened_90d ?? null,
    closed90d: first?.company_closed_90d ?? null,
    openCount,
    ghostFlaggedPct: ghostFlaggedPct(jobs),
    jobs,
    boards,
  };
}

import { decodeSlug, domainToSlug, getBoardsForDomain, slugToDomain } from "@/lib/boards/slug";
import { firstNonNull, resolveTrackRecord } from "@/lib/companies/aggregates";
import { resolveCompanyName } from "@/lib/companies/company-name";
import { resolveOpenCount } from "@/lib/companies/open-count";
import { resolveCompanyIntelligence } from "@/lib/companies/enrichment";
import { fetchCompanyNews } from "@/lib/companies/news";
import type { CompanyPageData } from "@/lib/companies/types";
import { displayCompanyName } from "@/lib/jobs/presentation";
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

  // Run concurrently with the jobs search — `fetchCompanyNews` fails soft to
  // `[]` on its own (missing endpoint, timeout, network error), so it can
  // never be the reason this function throws or returns late.
  const [result, news] = await Promise.all([
    search({
      companyDomain: domain,
      limit: COMPANY_JOBS_FETCH_LIMIT,
      hideGhosts: false,
    }),
    fetchCompanyNews(domain),
  ]);
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

  const name = resolveCompanyName(jobs, domain);
  const openCount = resolveOpenCount(result, jobs.length, COMPANY_JOBS_FETCH_LIMIT);
  const stage = firstNonNull(jobs, (j) => j.company_stage?.trim() || null);
  // The `company_*` aggregates land on documents progressively as the sync
  // re-writes them, so most of a company's hits still carry nothing while some
  // already do. Take them from the first hit that HAS them rather than from
  // `jobs[0]`, which made the track record depend on where the sorted window
  // happened to land — see aggregates.ts for why the pair is sourced from one
  // document and what happens when two documents disagree.
  // `company_open_count` is still deliberately NOT consulted for the count:
  // `resolveOpenCount` owns that decision because it is the only thing that
  // knows whether the number is exact or a floor.
  const trackRecord = resolveTrackRecord(jobs);
  const intelligence = resolveCompanyIntelligence(jobs, stage, news);

  return {
    domain,
    slug: domainToSlug(domain),
    // Legal-entity suffix stripped here — the ONE place `/co/[slug]` reads
    // its display name from (H1, `<title>`, OG image, JSON-LD all read
    // `data.name`) — rather than in `resolveCompanyName` itself, whose
    // `.value` other callers (the corpus tally, existing tests) depend on
    // keeping the suffix intact.
    name: displayCompanyName(name.value),
    nameSource: name.source,
    // No product tagline in the index yet — do not misuse company_stage as one.
    oneLiner: null,
    stage,
    opened90d: trackRecord?.opened90d ?? null,
    closed90d: trackRecord?.closed90d ?? null,
    hasTrackRecord: trackRecord !== null,
    openCount: openCount.value,
    openCountIsLowerBound: openCount.isLowerBound,
    ghostFlaggedPct: ghostFlaggedPct(jobs),
    jobs,
    boards,
    intelligence,
    // Read here — the async I/O boundary — not in the page component's
    // render body. See `CompanyPageData.nowMs`.
    nowMs: Date.now(),
  };
}

import { decodeSlug, domainToSlug, getBoardsForDomain, slugToDomain } from "@/lib/boards/slug";
import { extractCompanyAboutLine } from "@/lib/companies/about-line";
import { firstNonNull, resolveTrackRecord } from "@/lib/companies/aggregates";
import { resolveCompanyName } from "@/lib/companies/company-name";
import { collapseDuplicatePostings } from "@/lib/companies/dedupe-postings";
import { resolveOpenCount } from "@/lib/companies/open-count";
import { resolveCompanyIntelligence } from "@/lib/companies/enrichment";
import type { CompanyExhaust } from "@/lib/companies/exhaust";
import { getSharedCompanyExhaust } from "@/lib/companies/exhaust-cache";
import { fetchCompanyEvents } from "@/lib/companies/events";
import { fetchCompanyNews } from "@/lib/companies/news";
import type { CompanyChangeEvent, CompanyNewsArticle, CompanyPageData } from "@/lib/companies/types";
import { displayCompanyName, isInternalPosting } from "@/lib/jobs/presentation";
import { isUnavailableJobsResult, SEARCH_UNAVAILABLE_MESSAGE } from "@/lib/jobs/result-state";
import { searchJobs } from "@/lib/jobs/search";
import type { JobSearchParams, JobSearchResult, PublicJob } from "@/lib/jobs/types";
import { logServer, type LogAttrs } from "@/lib/observability/posthog-logs";

type SearchFn = (params: JobSearchParams) => Promise<JobSearchResult>;

/**
 * Hit window for the roles list. Named and exported because it is also the
 * saturation threshold `resolveOpenCount` needs — the count must know how
 * big the window was to know whether it filled up. It is NOT the count: that
 * conflation is exactly the bug this replaced.
 */
export const COMPANY_JOBS_FETCH_LIMIT = 200;

/**
 * A company page's roles search slower than this is logged (see
 * `getCompanyPageData`): it leaves too little of the 2s budget for rendering
 * 200 roles and the trip to the visitor. Nothing waits on it.
 */
export const SEARCH_BUDGET_MS = 1_000;

/** The page's reads other than the search, injectable for tests (same
 *  shape as the `search: SearchFn` parameter). */
export interface CompanySideReads {
  news: (domain: string) => Promise<CompanyNewsArticle[]>;
  events: (domain: string) => Promise<CompanyChangeEvent[]>;
  exhaust: (domain: string) => Promise<CompanyExhaust | null>;
  /** A search slower than this is logged. */
  budgetMs: number;
  log: (level: "warn", body: string, attrs: LogAttrs) => void;
}

const SIDE_READS: CompanySideReads = {
  news: fetchCompanyNews,
  events: fetchCompanyEvents,
  exhaust: getSharedCompanyExhaust,
  budgetMs: SEARCH_BUDGET_MS,
  log: logServer,
};

/** A read plus how long it took to settle, from `startedAt` (null while out). */
function timed<T>(read: Promise<T>, startedAt: number): { promise: Promise<T>; ms: () => number | null } {
  let ms: number | null = null;
  const settle = () => {
    ms = Date.now() - startedAt;
  };
  return { promise: read.finally(settle), ms: () => ms };
}

/** The read's value if it settles before `deadline`, else `fallback`. */
function byDeadline<T>(read: Promise<T>, deadline: Promise<unknown>, fallback: T): Promise<{ value: T; late: boolean }> {
  return Promise.race([
    read.then((value) => ({ value, late: false })),
    deadline.then(() => ({ value: fallback, late: true })),
  ]);
}

function ghostFlaggedPct(jobs: PublicJob[]): number | null {
  if (jobs.length === 0) return null;
  const flagged = jobs.filter((j) => j.ghost_badge === "likely_ghost").length;
  return Math.round((flagged / jobs.length) * 100);
}

export async function getCompanyPageData(
  slug: string,
  search: SearchFn = searchJobs,
  deps: Partial<CompanySideReads> = {},
): Promise<CompanyPageData | null> {
  const allowlisted = slugToDomain(slug);
  const domain = allowlisted ?? decodeSlug(slug);
  if (!domain) return null;

  // The roles come from the search; news, recent changes and the box
  // database's record (hiring record, posting chart, profile) are side
  // reads. All four start together, and the page waits for the search
  // alone: a side read still out when the search answers is left off this
  // render, as if it had nothing, instead of holding the roles back. Each
  // side read already fails soft on its own, and a late one still finishes
  // into its cache (Next's fetch cache for news and events,
  // `exhaust-cache.ts` for the box), so the next visit has it. The first
  // visit to a big employer took 4.3s on release 16, against a 2s budget for
  // every list; release 20 let side reads hold the roles for up to 1s, and
  // on release 23 a cold box read for Amazon (1.4s) still cost its first
  // visitor that whole second.
  const reads = { ...SIDE_READS, ...deps };
  const startedAt = Date.now();
  const searchRead = timed(
    search({
      companyDomain: domain,
      limit: COMPANY_JOBS_FETCH_LIMIT,
      hideGhosts: false,
    }),
    startedAt,
  );
  const sideReads = {
    news: timed(reads.news(domain).catch((): CompanyNewsArticle[] => []), startedAt),
    events: timed(reads.events(domain).catch((): CompanyChangeEvent[] => []), startedAt),
    box: timed(reads.exhaust(domain).catch(() => null), startedAt),
  };
  const allSideReads = Promise.all([sideReads.news.promise, sideReads.events.promise, sideReads.box.promise]);
  const deadline = searchRead.promise.catch(() => undefined);

  const [result, news, changeEvents, exhaust] = await Promise.all([
    searchRead.promise,
    byDeadline(sideReads.news.promise, deadline, [] as CompanyNewsArticle[]),
    byDeadline(sideReads.events.promise, deadline, [] as CompanyChangeEvent[]),
    byDeadline(sideReads.box.promise, deadline, null as CompanyExhaust | null),
  ]);
  const late = [
    news.late && "news",
    changeEvents.late && "events",
    exhaust.late && "box",
  ].filter((name): name is string => !!name);
  if (late.length > 0 || (searchRead.ms() ?? 0) > reads.budgetMs) {
    // Once every read has answered, so the record has all four times.
    void allSideReads.then(() =>
      reads.log("warn", "company page reads over budget", {
        "company.domain": domain,
        "budget.ms": reads.budgetMs,
        "search.ms": searchRead.ms() ?? undefined,
        "news.ms": sideReads.news.ms() ?? undefined,
        "events.ms": sideReads.events.ms() ?? undefined,
        "box.ms": sideReads.box.ms() ?? undefined,
        // How much of search.ms the search engine itself spent, and in how
        // many requests: the rest is the trip between the boxes.
        "search.engine.ms": result.engineMs,
        "search.calls": result.engineCalls,
        "left.off": late.join(",") || undefined,
      }),
    );
  }

  // A failed search (bad/unfilterable index config, live outage) must never
  // be read as "this company has zero jobs" — that's how the animana--com
  // 400 became a false 404. Distinguish via the same `unavailable` signal
  // every other searchJobs caller already checks (hot-list.ts, follows/
  // alerts.ts, jobs/page.tsx) and propagate it as a throw, so Next renders
  // its error boundary/500 instead of a confident "not found."
  if (isUnavailableJobsResult(result)) {
    throw new Error(result.note ?? SEARCH_UNAVAILABLE_MESSAGE);
  }
  // Internal-only postings ("[Internal] ...") are staffing noise, never a
  // role this public page should list, count, or name the company from;
  // re-synced duplicate postings (the same role ingested twice under a
  // second id — `collapseDuplicatePostings`, dedupe-postings.ts) are the
  // same kind of noise. Both are filtered once, here, so every downstream
  // reader (the roles list, the open-role count, the ghost-flagged share,
  // the name resolver, the in-page role search) sees the SAME final array
  // instead of each re-deriving its own view of it — the seam that used to
  // let the hero KPI (sourced from this array pre-dedup) and the rendered
  // role list (deduped a second time, client-side) disagree.
  const jobs = collapseDuplicatePostings(result.hits.filter((job) => !isInternalPosting(job.title)));
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
  const intelligence = resolveCompanyIntelligence(jobs, stage, news.value);
  // Legal-entity suffix stripped here — the ONE place `/co/[slug]` reads its
  // display name from (H1, `<title>`, OG image, JSON-LD all read
  // `data.name`) — rather than in `resolveCompanyName` itself, whose
  // `.value` other callers (the corpus tally, existing tests) depend on
  // keeping the suffix intact. Reused below for the about-line extraction so
  // both read the same brand token instead of each re-deriving it.
  const displayName = displayCompanyName(name.value);

  return {
    domain,
    slug: domainToSlug(domain),
    name: displayName,
    nameSource: name.source,
    // Sourced from the company's own job postings (extractCompanyAboutLine)
    // — never a dedicated tagline field (the index has none) and never
    // invented. Null when no confident extraction was found.
    oneLiner: extractCompanyAboutLine(jobs, displayName),
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
    changeEvents: changeEvents.value,
    exhaust: exhaust.value,
    // Read here — the async I/O boundary — not in the page component's
    // render body. See `CompanyPageData.nowMs`.
    nowMs: Date.now(),
  };
}

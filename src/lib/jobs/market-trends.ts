/**
 * Data composer for the /trends market-stats page (Phase 1 — see
 * docs/specs/2026-07-29-market-trends-page.md). Mirrors `search.ts`'s role
 * for /jobs: this module owns WHICH Meilisearch queries the page needs and
 * how to turn the raw response into page-shaped data; `meilisearch.ts` only
 * knows how to talk to the index.
 *
 * Every query batches through ONE `meiliMultiSearch` call (meilisearch.ts) —
 * a single HTTP round trip per ISR revalidation, never a per-visitor query.
 * Every TOTAL (as opposed to a single facet value) routes through
 * `resolveCorpusCount` (corpus-count.ts) so a `maxTotalHits`-capped response
 * recovers its real count from the uncapped facet distribution instead of
 * silently reporting the cap — the same honesty guard /jobs already relies
 * on, extended here rather than reimplemented.
 */
import { unstable_cache } from "next/cache";
import { resolveCorpusCount, type CorpusCount } from "./corpus-count";
import { isBuildPhase } from "@/lib/next-phase";
import {
  rollupCountryDistribution,
  type CountryRollupRow,
} from "./country-classification";
import { last14UtcDays } from "./day-buckets";
import { fetchMarketStats, type MarketStats } from "./market-stats";
import { hasMeilisearch, meiliMultiSearch, type MeiliAggregationResult } from "./meilisearch";
import { FRESHNESS_BUCKETS, postingAgeFilterClauses, type FreshnessBucket } from "./posting-age-buckets";
import type { GhostBadge } from "./types";
import { capitalizeWords } from "@/lib/text-case";

const ACTIVE_FILTER = 'vacancy_status = "active"';

/** Display order for the ghost-radar breakdown — severity-ish, "unscored"
 *  (no signal) last. Matches FilterPanel's `VALUE_LABELS.ghost_badge` order. */
const GHOST_BADGES: readonly GhostBadge[] = ["clear", "caution", "likely_ghost", "unscored"];

export interface TrendFacetItem {
  key: string;
  label: string;
  count: number;
  pct: number;
  rawKey: string;
}

export interface MarketTrendsData {
  liveJobs: CorpusCount;
  totalTracked: CorpusCount;
  ghostFlaggedLive: CorpusCount;
  topCountries: CountryRollupRow[];
  freshness: { bucket: FreshnessBucket; count: CorpusCount }[];
  ghostRadar: { badge: GhostBadge; count: CorpusCount }[];
  workTypeDistribution: TrendFacetItem[];
  experienceDistribution: TrendFacetItem[];
  employmentTypeDistribution: TrendFacetItem[];
  visaSponsorshipDistribution: { sponsoredCount: number; sponsoredPct: number; totalCount: number };
  /** Closure flow — the counterpart to `liveJobs`, for "Market pulse".
   *
   *  `null` when the published totals are unavailable (publisher hasn't run,
   *  or its task is still queued). Callers MUST omit the claim rather than
   *  render a 0: this field replaced a query that could only ever return 0,
   *  and printing a fallback zero would restore that bug through a new pipe.
   *
   *  Carries its own `windowDays` — these are 90-day figures, NOT all-time,
   *  which is what the previous field name asserted. */
  closed: MarketStats | null;
  /** Posted-per-day counts, last 14 UTC calendar days (oldest first) — every
   *  status, not just active, so a posting that has since closed still
   *  counts on the day it was actually posted. */
  postedPerDay: { date: string; count: CorpusCount }[];
  /** Of all ACTIVE postings, the % that are older than 60 days — derived
   *  from `liveJobs` and the `freshness` "older" bucket above (zero extra
   *  queries; see `computeStaleActiveSharePct`). */
  staleActiveSharePct: number;
  /** `source` facet distribution across active postings — ATS-platform
   *  identifiers ("workday_direct", "greenhouse_direct", …), NOT company
   *  identity (see TrendsHero's doc for why that distinction rules out a
   *  companies-count stat). Sorted by count, descending; empty when the
   *  facet came back empty. */
  sourceCoverage: { source: string; count: number }[];
}

const WORK_TYPE_LABELS: Record<string, string> = {
  remote: "Fully Remote",
  hybrid: "Hybrid",
  onsite: "On-site",
};

const EXPERIENCE_LEVEL_LABELS: Record<string, string> = {
  senior: "Senior",
  mid: "Mid-Level",
  entry: "Entry & Junior",
  lead: "Staff & Lead",
  executive: "Executive & Director",
};

const EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  full_time: "Full-Time",
  contract: "Contract",
  internship: "Internship",
  part_time: "Part-Time",
};

export function formatFacetDistribution(
  dist: Record<string, number> | undefined,
  labelMap: Record<string, string>,
  preferredOrder?: string[],
): TrendFacetItem[] {
  if (!dist) return [];
  const entries = Object.entries(dist).filter(
    ([k, v]) => v > 0 && k !== "unknown" && k !== "unspecified",
  );
  const total = entries.reduce((sum, [, v]) => sum + v, 0);
  if (total === 0) return [];

  const items: TrendFacetItem[] = entries.map(([rawKey, count]) => ({
    key: rawKey,
    label: labelMap[rawKey] || capitalizeWords(rawKey.replace(/_/g, " ")),
    count,
    pct: Math.round((count / total) * 100),
    rawKey,
  }));

  if (preferredOrder) {
    items.sort((a, b) => {
      const idxA = preferredOrder.indexOf(a.rawKey);
      const idxB = preferredOrder.indexOf(b.rawKey);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return b.count - a.count;
    });
  } else {
    items.sort((a, b) => b.count - a.count);
  }

  return items;
}

/**
 * Pure: % of the active corpus that's older than 60 days, given the active
 * total and the `freshness` "older" bucket's count (both already fetched —
 * the "older" bucket count is, by construction, a subset of the active
 * total: it's `ACTIVE_FILTER` AND `posted_ts` older than 60d). Zero active
 * postings is a valid state (e.g. a probe/test index), not a crash — return
 * 0 rather than NaN/Infinity from a 0/0 division.
 */
export function computeStaleActiveSharePct(activeTotal: number, olderThan60d: number): number {
  if (activeTotal <= 0) return 0;
  return Math.round((olderThan60d / activeTotal) * 100);
}

/** Adapt a raw `/multi-search` result into the same `{total, facetDistribution}`
 *  shape `resolveCorpusCount` expects — same `totalHits ?? estimatedTotalHits`
 *  fallback `searchMeili` uses when building a `JobSearchResult`. */
function toCorpusCount(result: MeiliAggregationResult): CorpusCount {
  const dist = result.facetDistribution?.ghost_badge;
  return resolveCorpusCount({
    total: result.totalHits ?? result.estimatedTotalHits ?? 0,
    facetDistribution: dist ? { ghost_badge: dist } : undefined,
  });
}

/**
 * Fetch and assemble every number the /trends page renders. Returns `null`
 * when Meilisearch isn't configured at all (matches `hasMeilisearch`'s use
 * elsewhere) or when the fetch fails during the build prerender (no stale
 * copy exists yet — the first successful revalidation replaces the shell).
 * At runtime any failure (network, non-2xx) still throws, so a failed ISR
 * revalidation falls back to Next's stale-while-error behavior instead of
 * the page quietly rendering fabricated zeros.
 */
export async function fetchMarketTrends(): Promise<MarketTrendsData | null> {
  if (!hasMeilisearch()) return null;
  const now = Date.now();
  const dayRanges = last14UtcDays(now);

  let results;
  try {
    results = await meiliMultiSearch([
      // 0: active docs — drives live-jobs total, the country rollup, the
      // market-wide ghost radar, work types, experience levels, visa stats,
      // and the source/ATS coverage list in ONE single request.
      {
        filter: [ACTIVE_FILTER],
        facets: [
          "location_country",
          "ghost_badge",
          "source",
          "work_type",
          "experience_level",
          "employment_type",
          "visa_sponsorship",
        ],
      },
      // 1: every doc, no filter — all-time tracked total.
      { facets: ["ghost_badge"] },
      // 2-5: one posting-age bucket per query, active postings only.
      ...FRESHNESS_BUCKETS.map((bucket) => ({
        filter: [ACTIVE_FILTER, ...postingAgeFilterClauses(bucket, now)],
        facets: ["ghost_badge"],
      })),
      // 6-19: one bare count query per day, last 14 UTC days.
      ...dayRanges.map((range) => ({
        filter: [`posted_ts >= ${range.startMs}`, `posted_ts < ${range.endMs}`],
      })),
    ]);
  } catch (err) {
    if (isBuildPhase()) return null;
    throw err;
  }

  const [activeResult, allTimeResult, ...rest] = results;
  const freshnessResults = rest.slice(0, FRESHNESS_BUCKETS.length);
  const dailyResults = rest.slice(FRESHNESS_BUCKETS.length);
  const activeGhostDist = activeResult.facetDistribution?.ghost_badge ?? {};

  const liveJobs = toCorpusCount(activeResult);
  const freshness = FRESHNESS_BUCKETS.map((bucket, i) => ({
    bucket,
    count: toCorpusCount(freshnessResults[i]),
  }));
  const olderBucket = freshness.find((f) => f.bucket === "older");
  const sourceDist = activeResult.facetDistribution?.source ?? {};

  const workDist = activeResult.facetDistribution?.work_type ?? {};
  const expDist = activeResult.facetDistribution?.experience_level ?? {};
  const empDist = activeResult.facetDistribution?.employment_type ?? {};
  const visaDist = activeResult.facetDistribution?.visa_sponsorship ?? {};

  const visaTrue = visaDist.true ?? visaDist["true"] ?? 0;
  const visaFalse = visaDist.false ?? visaDist["false"] ?? 0;
  const visaTotal = visaTrue + visaFalse;
  const visaSponsoredPct = visaTotal > 0 ? Math.round((visaTrue / visaTotal) * 100) : 0;

  return {
    liveJobs,
    totalTracked: toCorpusCount(allTimeResult),
    ghostFlaggedLive: { kind: "exact", value: activeGhostDist.likely_ghost ?? 0 },
    topCountries: rollupCountryDistribution(activeResult.facetDistribution?.location_country),
    ghostRadar: GHOST_BADGES.map((badge) => ({
      badge,
      count: { kind: "exact", value: activeGhostDist[badge] ?? 0 } as CorpusCount,
    })),
    workTypeDistribution: formatFacetDistribution(workDist, WORK_TYPE_LABELS, [
      "remote",
      "hybrid",
      "onsite",
    ]),
    experienceDistribution: formatFacetDistribution(expDist, EXPERIENCE_LEVEL_LABELS, [
      "entry",
      "mid",
      "senior",
      "lead",
      "executive",
    ]),
    employmentTypeDistribution: formatFacetDistribution(empDist, EMPLOYMENT_TYPE_LABELS, [
      "full_time",
      "contract",
      "internship",
      "part_time",
    ]),
    visaSponsorshipDistribution: {
      sponsoredCount: visaTrue,
      sponsoredPct: visaSponsoredPct,
      totalCount: visaTotal,
    },
    freshness,
    closed: await fetchMarketStats(),
    postedPerDay: dayRanges.map((range, i) => ({
      date: range.dateLabel,
      count: toCorpusCount(dailyResults[i]),
    })),
    staleActiveSharePct: computeStaleActiveSharePct(liveJobs.value, olderBucket?.count.value ?? 0),
    sourceCoverage: Object.entries(sourceDist)
      .sort((a, b) => b[1] - a[1])
      .map(([source, count]) => ({ source, count })),
  };
}

/**
 * The single cached loader for this aggregation (ITEM U, 2026-08-15). Before
 * this, two independent clocks read the same underlying fact: the TopBar
 * ticker + jobs/page.tsx's landing claim went through `unstable_cache` here
 * (900s), while /trends called `fetchMarketTrends` directly and rode its own
 * page-level `revalidate` (1800s) instead — two windows over one number, so
 * a visitor could see the ticker and the /trends card disagree by however
 * much the two clocks had drifted apart. Every site-wide "live roles" render
 * site now goes through this one export; do not add a second
 * `unstable_cache` wrapper around `fetchMarketTrends` anywhere else.
 *
 * Only the successful-data path is cached — a null/thrown result must never
 * be cached, or a Meili outage would stay "down" for the whole revalidation
 * window instead of recovering on the next request.
 */
export const getCachedMarketTrends = unstable_cache(
  async () => {
    const data = await fetchMarketTrends();
    if (!data) throw new Error("fetchMarketTrends returned null");
    return data;
  },
  ["marketing-stats-market-trends"],
  { revalidate: 900 },
);

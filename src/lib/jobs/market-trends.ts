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

const ACTIVE_FILTER = 'vacancy_status = "active"';

/** Display order for the ghost-radar breakdown — severity-ish, "unscored"
 *  (no signal) last. Matches FilterPanel's `VALUE_LABELS.ghost_badge` order. */
const GHOST_BADGES: readonly GhostBadge[] = ["clear", "caution", "likely_ghost", "unscored"];

export interface MarketTrendsData {
  liveJobs: CorpusCount;
  totalTracked: CorpusCount;
  ghostFlaggedLive: CorpusCount;
  topCountries: CountryRollupRow[];
  freshness: { bucket: FreshnessBucket; count: CorpusCount }[];
  ghostRadar: { badge: GhostBadge; count: CorpusCount }[];
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
      // market-wide ghost radar, AND the source/ATS coverage list (all four
      // read off this ONE query's response — adding "source" to an existing
      // query's facets list costs nothing extra on the round trip).
      { filter: [ACTIVE_FILTER], facets: ["location_country", "ghost_badge", "source"] },
      // 1: every doc, no filter — all-time tracked total.
      { facets: ["ghost_badge"] },
      // 2-5: one posting-age bucket per query, active postings only.
      ...FRESHNESS_BUCKETS.map((bucket) => ({
        filter: [ACTIVE_FILTER, ...postingAgeFilterClauses(bucket, now)],
        facets: ["ghost_badge"],
      })),
      // The closed total used to be query 6 here, as
      // `vacancy_status = "closed"`. It is gone because this index cannot
      // answer it: no closed document has ever been in it (the snapshot
      // endpoint filters them out, the reconcile evicts them), so the query
      // returned 0 on every run and the page printed that 0 as a
      // measurement. Live facets 2026-08-12: {"active": 1971746,
      // "unknown": 249574} — no "closed" key at all. The figure now comes
      // from `fetchMarketStats` (market-stats.ts), sourced from Postgres.
      // Do not reinstate a closed filter here.
      //
      // 6-19: one bare count query per day, last 14 UTC days — every
      // status (not ACTIVE_FILTER-scoped), so a posting that's since closed
      // still counts on the day it was actually posted. No facets: a single
      // day's postings are nowhere near CORPUS_COUNT_CAP, so cap-recovery
      // isn't needed, and skipping it keeps these 14 queries cheap.
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
  // No `+ 1` — the closed query that used to sit between these two is gone
  // (see the batch above). This offset is why it was removed here rather
  // than left in as a harmless no-op query.
  const dailyResults = rest.slice(FRESHNESS_BUCKETS.length);
  const activeGhostDist = activeResult.facetDistribution?.ghost_badge ?? {};

  const liveJobs = toCorpusCount(activeResult);
  const freshness = FRESHNESS_BUCKETS.map((bucket, i) => ({
    bucket,
    count: toCorpusCount(freshnessResults[i]),
  }));
  const olderBucket = freshness.find((f) => f.bucket === "older");
  const sourceDist = activeResult.facetDistribution?.source ?? {};

  return {
    liveJobs,
    totalTracked: toCorpusCount(allTimeResult),
    // A single facet VALUE's count (not a query total), so it's already
    // uncapped straight off the response — no cap-recovery needed, unlike
    // the totals above (see corpus-count.ts's own facetDistribution note).
    ghostFlaggedLive: { kind: "exact", value: activeGhostDist.likely_ghost ?? 0 },
    topCountries: rollupCountryDistribution(activeResult.facetDistribution?.location_country),
    ghostRadar: GHOST_BADGES.map((badge) => ({
      badge,
      count: { kind: "exact", value: activeGhostDist[badge] ?? 0 } as CorpusCount,
    })),
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

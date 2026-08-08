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
import { resolveCorpusCount, type CorpusCount } from "./corpus-count";
import { isBuildPhase } from "@/lib/next-phase";
import {
  rollupCountryDistribution,
  type CountryRollupRow,
} from "./country-classification";
import { last14UtcDays } from "./day-buckets";
import { hasMeilisearch, meiliMultiSearch, type MeiliAggregationResult } from "./meilisearch";
import { FRESHNESS_BUCKETS, postingAgeFilterClauses, type FreshnessBucket } from "./posting-age-buckets";
import type { GhostBadge } from "./types";

const ACTIVE_FILTER = 'vacancy_status = "active"';
const CLOSED_FILTER = 'vacancy_status = "closed"';

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
  /** All-time closed-postings total (vacancy_status = "closed") — the flow
   *  counterpart to `liveJobs`, added for the /trends "Market pulse" section. */
  closedTotal: CorpusCount;
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
      // 6: all-time closed total — the flow counterpart to `liveJobs`.
      // Requests the same `ghost_badge` cap-recovery facet as every other
      // TOTAL query above; closed is plausibly the largest number on this
      // page (accumulates over the corpus's whole history), the likeliest
      // one to actually hit `CORPUS_COUNT_CAP`.
      { filter: [CLOSED_FILTER], facets: ["ghost_badge"] },
      // 7-20: one bare count query per day, last 14 UTC days — every
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
  const closedResult = rest[FRESHNESS_BUCKETS.length];
  const dailyResults = rest.slice(FRESHNESS_BUCKETS.length + 1);
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
    closedTotal: toCorpusCount(closedResult),
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

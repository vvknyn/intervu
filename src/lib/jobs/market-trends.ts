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

  let results;
  try {
    results = await meiliMultiSearch([
      // 0: active docs — drives live-jobs total, the country rollup, and the
      // market-wide ghost radar (all three read off ONE query's response).
      { filter: [ACTIVE_FILTER], facets: ["location_country", "ghost_badge"] },
      // 1: every doc, no filter — all-time tracked total.
      { facets: ["ghost_badge"] },
      // 2-5: one posting-age bucket per query, active postings only.
      ...FRESHNESS_BUCKETS.map((bucket) => ({
        filter: [ACTIVE_FILTER, ...postingAgeFilterClauses(bucket, now)],
        facets: ["ghost_badge"],
      })),
    ]);
  } catch (err) {
    if (isBuildPhase()) return null;
    throw err;
  }

  const [activeResult, allTimeResult, ...freshnessResults] = results;
  const activeGhostDist = activeResult.facetDistribution?.ghost_badge ?? {};

  return {
    liveJobs: toCorpusCount(activeResult),
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
    freshness: FRESHNESS_BUCKETS.map((bucket, i) => ({
      bucket,
      count: toCorpusCount(freshnessResults[i]),
    })),
  };
}

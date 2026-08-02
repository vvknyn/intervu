import type { CorpusCount } from "@/lib/jobs/corpus-count";
import type { MarketTrendsData } from "@/lib/jobs/market-trends";

/**
 * The landing proof band's three live numbers. Sourced from the same
 * aggregation `/trends` already runs (`fetchMarketTrends`) — never a
 * hardcoded count that would rot as the corpus grows (mirrors
 * `MarketingCorpusStats` in `@/lib/marketing-stats`, extended with the two
 * extra fields the landing spec wants that the existing action doesn't
 * expose).
 */
export interface ProofBandStats {
  liveJobs: CorpusCount;
  /** Whole-number percent of live jobs carrying ANY ghost-risk verdict
   *  (i.e. not "unscored"). */
  screenedSharePct: number;
  flaggedCount: CorpusCount;
}

/**
 * Pure deriver: turn one `fetchMarketTrends` response into the proof band's
 * shape. Returns `null` only when `data` itself is `null` (Meili unconfigured
 * or build-time fetch failure) — the caller renders qualitative-only copy in
 * that case, never a fabricated number.
 */
export function deriveProofBandStats(data: MarketTrendsData | null): ProofBandStats | null {
  if (!data) return null;
  const total = data.liveJobs.value;
  const unscored = data.ghostRadar.find((r) => r.badge === "unscored")?.count.value ?? 0;
  const screenedSharePct = total > 0 ? Math.round(100 - (unscored / total) * 100) : 0;
  return {
    liveJobs: data.liveJobs,
    screenedSharePct,
    flaggedCount: data.ghostFlaggedLive,
  };
}

import { formatCorpusCount, type CorpusCount } from "@/lib/jobs/corpus-count";

/**
 * The honest-market claim's factual core — scrape provenance + ghost
 * screening. Single source of truth: the landing claim sentence and the
 * footer's one-line descriptor both read this exact phrase rather than
 * drifting into two independently-edited wordings of the same fact.
 */
export const CORPUS_SOURCE_DESCRIPTOR =
    "scraped from companies' own career pages, screened for ghost-job risk";

/**
 * Numbers the landing claim can render when available. Sourced from the same
 * aggregation `/trends` runs (`fetchMarketTrends`) — never a hardcoded count
 * that would rot as the corpus grows.
 */
export interface MarketingCorpusStats {
    liveJobs: CorpusCount;
}

/**
 * Build the landing page's honest-market claim sentence. Renders the live
 * corpus count when it's known; otherwise degrades to the same claim without
 * a number — never a stale or fabricated placeholder count (see
 * `getMarketingStatsAction`, which returns `null` on the same conditions
 * `fetchMarketTrends` itself degrades on).
 */
export function marketingClaim(stats: MarketingCorpusStats | null): string {
    if (!stats) {
        return `Every live role is ${CORPUS_SOURCE_DESCRIPTOR} — before you spend an hour on it.`;
    }
    const n = formatCorpusCount(stats.liveJobs);
    return `${n} live roles, ${CORPUS_SOURCE_DESCRIPTOR} — before you spend an hour on any of them.`;
}

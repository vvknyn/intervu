import { formatCorpusCount, type CorpusCount } from "@/lib/jobs/corpus-count";

/**
 * The honest-market claim's factual core — scrape provenance + ghost
 * screening. Single source of truth: the landing claim sentence and the
 * footer's one-line descriptor both read this exact phrase rather than
 * drifting into two independently-edited wordings of the same fact.
 */
export const CORPUS_SOURCE_DESCRIPTOR =
    "scraped from companies' own career pages, screened for postings that aren't really live";

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

/** Site footer's one-line provenance claim — same fact as the landing claim,
 *  one source. The old footer sentence ended "…Same market your agent sees
 *  via MCP." — machinery language on every guest page; dropped 2026-08-07
 *  (docs/specs/2026-08-07-job-seeker-front-door-design.md). */
export const FOOTER_PROVENANCE_LINE = `Every listing is ${CORPUS_SOURCE_DESCRIPTOR} — never resold, never curated.`;

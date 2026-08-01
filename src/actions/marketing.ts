"use server";

import { fetchMarketTrends } from "@/lib/jobs/market-trends";
import type { MarketingCorpusStats } from "@/lib/marketing-stats";

/**
 * Thin I/O wrapper for the landing claim's live number. `marketing-stats.ts`
 * owns the copy/formatting decision (pure, unit-tested); this just sources
 * the one field it needs off the same aggregation `/trends` already runs,
 * called from the client landing page like the other client-invoked actions
 * in `@/actions/jobs` (e.g. `getJobsFreshnessAction`).
 */
export async function getMarketingStatsAction(): Promise<MarketingCorpusStats | null> {
    const data = await fetchMarketTrends();
    return data ? { liveJobs: data.liveJobs } : null;
}

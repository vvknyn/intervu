"use server";

import { unstable_cache } from "next/cache";
import { fetchMarketTrends } from "@/lib/jobs/market-trends";
import type { MarketingCorpusStats } from "@/lib/marketing-stats";

/**
 * `fetchMarketTrends` runs a full Meilisearch multi-search aggregation.
 * Cache it for 15 minutes so every `/jobs` visitor mount doesn't hit the
 * cluster directly. Only the successful-data path is wrapped — a null/thrown
 * result must never be cached, or a Meili outage would stay "down" for the
 * whole revalidation window instead of recovering on the next request.
 */
const getCachedMarketTrends = unstable_cache(
    async () => {
        const data = await fetchMarketTrends();
        if (!data) throw new Error("fetchMarketTrends returned null");
        return data;
    },
    ["marketing-stats-market-trends"],
    { revalidate: 900 },
);

/**
 * Thin I/O wrapper for the landing claim's live number. `marketing-stats.ts`
 * owns the copy/formatting decision (pure, unit-tested); this just sources
 * the one field it needs off the same aggregation `/trends` already runs,
 * called from the client landing page like the other client-invoked actions
 * in `@/actions/jobs` (e.g. `getJobsFreshnessAction`).
 */
export async function getMarketingStatsAction(): Promise<MarketingCorpusStats | null> {
    try {
        const data = await getCachedMarketTrends();
        return { liveJobs: data.liveJobs };
    } catch {
        // Meili/index unavailable — landing omits the count rather than crashing.
        return null;
    }
}

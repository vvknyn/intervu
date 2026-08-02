"use server";

import { fetchMarketTrends } from "@/lib/jobs/market-trends";
import { deriveProofBandStats, type ProofBandStats } from "./proof-band";

/**
 * Thin I/O wrapper for the landing proof band. `proof-band.ts` owns the
 * derivation (pure, unit-tested); this just sources the one Meili round trip
 * `/trends` already runs (`fetchMarketTrends`) — no reimplemented
 * aggregation — called from the client landing section the same way
 * `getMarketingStatsAction` is called from `page.tsx`.
 */
export async function getProofBandStatsAction(): Promise<ProofBandStats | null> {
  const data = await fetchMarketTrends();
  return deriveProofBandStats(data);
}

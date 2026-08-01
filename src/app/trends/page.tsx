import type { Metadata } from "next";
import { fetchMarketTrends } from "@/lib/jobs/market-trends";
import { TrendsHero } from "@/components/trends/TrendsHero";
import { TopCountriesList } from "@/components/trends/TopCountriesList";
import { PostingFreshnessBand } from "@/components/trends/PostingFreshnessBand";
import { MarketGhostRadar } from "@/components/trends/MarketGhostRadar";

export const metadata: Metadata = {
  title: "Market trends",
  description: "Live market stats from the jobs we track — hiring countries, posting freshness, ghost-job risk.",
};

// ISR: every Meili aggregation this page needs is batched server-side into
// ONE /multi-search round trip (see fetchMarketTrends) and cached for this
// window — never a per-visitor query against a box already measured at
// 4-7s per facet query under embed-backfill load (spec).
export const revalidate = 1800;

export default async function TrendsPage() {
  const data = await fetchMarketTrends();

  if (!data) {
    return (
      <main data-testid="trends-page" className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <p className="text-sm text-muted-foreground">Market data isn&apos;t available right now.</p>
      </main>
    );
  }

  return (
    <main data-testid="trends-page" className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <header>
        <h1 className="font-display text-display font-extrabold text-foreground">Market trends</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Live stats from the jobs corpus we track — scraped from companies&apos; own career pages, not curated.
        </p>
      </header>

      <TrendsHero
        liveJobs={data.liveJobs}
        totalTracked={data.totalTracked}
        ghostFlaggedLive={data.ghostFlaggedLive}
      />
      <TopCountriesList countries={data.topCountries} />
      <PostingFreshnessBand freshness={data.freshness} />
      <MarketGhostRadar ghostRadar={data.ghostRadar} />
    </main>
  );
}

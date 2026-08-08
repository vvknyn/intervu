import type { Metadata } from "next";
import { fetchMarketTrends } from "@/lib/jobs/market-trends";
import { PageHeader } from "@/components/layout/PageHeader";
import { TrendsHero } from "@/components/trends/TrendsHero";
import { TopCountriesList } from "@/components/trends/TopCountriesList";
import { PostingFreshnessBand } from "@/components/trends/PostingFreshnessBand";
import { MarketGhostRadar } from "@/components/trends/MarketGhostRadar";
import { canonicalMetadata } from "@/lib/seo/page-metadata";

// A plain `export const metadata` object can't carry the current month, so
// this is `generateMetadata` instead — computed at request/revalidation
// time (same cadence as the page's own `revalidate` below), never a
// hand-maintained date literal that goes stale.
export async function generateMetadata(): Promise<Metadata> {
  const asOf = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const title = "Market trends";
  const description = `Live ghost-job and hiring stats — hiring countries, posting freshness, ghost-job risk. Snapshot as of ${asOf}.`;
  return {
    title,
    description,
    ...canonicalMetadata("/trends", title, description),
  };
}

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
      {/* `bare`: this page isn't rendered through `PageLayout`'s `header`
          slot, so it needs the title row only, embedded inline in its own
          content column (same shape as Prep's landing view). No `actions`
          status line — the mock's "snapshot · updated Xh ago" needs an
          as-of timestamp `fetchMarketTrends` doesn't return, and fabricating
          one would misrepresent freshness. */}
      <PageHeader
        bare
        size="display"
        title="Market trends"
        description="Live stats from the jobs corpus we track — scraped from companies&apos; own career pages, not curated."
      />

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

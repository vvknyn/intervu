import type { Metadata } from "next";
import { getCachedMarketTrends } from "@/lib/jobs/market-trends";
import {
  captureDailySnapshotIfAbsent,
  computeLatestDelta,
  readRecentSnapshots,
  sinceLabel,
  type DailySnapshotDoc,
} from "@/lib/trends/daily-snapshot";
import { PageHeader } from "@/components/layout/PageHeader";
import { TrendsHero } from "@/components/trends/TrendsHero";
import { TopCountriesList } from "@/components/trends/TopCountriesList";
import { PostingFreshnessBand } from "@/components/trends/PostingFreshnessBand";
import { MarketGhostRadar } from "@/components/trends/MarketGhostRadar";
import { MarketPulse } from "@/components/trends/MarketPulse";
import { WorkArrangementDistribution } from "@/components/trends/WorkArrangementDistribution";
import { ExperienceSeniorityDistribution } from "@/components/trends/ExperienceSeniorityDistribution";
import { canonicalMetadata } from "@/lib/seo/page-metadata";

/**
 * The daily-snapshot delta/tracking-since lines (P2, daily-snapshot.ts) —
 * kept local to this page rather than folded into MarketPulse.tsx so the P1
 * "Market pulse" stats section has no dependency on the snapshot module
 * (independently shippable pieces). Net numbers only — every label says NET/
 * newly-marked, never "flow" (a snapshot diff can't distinguish "3 posted, 1
 * closed" from "2 net new"; see daily-snapshot.ts's module doc). Renders
 * nothing until at least one snapshot exists — no empty promises.
 */
function DailySnapshotSummary({ snapshots }: { snapshots: DailySnapshotDoc[] }) {
  const firstSnapshotDate = snapshots[0]?.date;
  if (!firstSnapshotDate) return null;
  const delta = computeLatestDelta(snapshots);

  return (
    <>
      {delta && (
        <p data-testid="trends-pulse-delta" className="mt-1 text-sm text-muted-foreground">
          Since {sinceLabel(delta.sinceDate, snapshots[snapshots.length - 1].date)}:{" "}
          {delta.netActiveChange >= 0 ? "+" : ""}
          {delta.netActiveChange.toLocaleString()} net active · {delta.newlyClosed.toLocaleString()} newly closed
        </p>
      )}
      <p data-testid="trends-pulse-tracking-since" className="mt-1 font-mono text-[11px] text-muted-foreground">
        tracking daily since {firstSnapshotDate}
      </p>
    </>
  );
}

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
export const revalidate = 900;

export default async function TrendsPage() {
  const data = await getCachedMarketTrends().catch(() => null);

  if (!data) {
    return (
      <main data-testid="trends-page" className="mx-auto max-w-6xl xl:max-w-7xl px-4 py-10 sm:px-8 xl:px-10">
        <p className="text-sm text-muted-foreground">Market data isn&apos;t available right now.</p>
      </main>
    );
  }

  // Lazy daily snapshot (P2): create-if-absent off THIS fetch's numbers (no
  // extra Meili cost), never throws — see daily-snapshot.ts's module doc.
  if (data.closed) {
    await captureDailySnapshotIfAbsent({
      totalDocs: data.totalTracked.value,
      active: data.liveJobs.value,
      closed: data.closed.closed,
    });
  }
  const snapshots = await readRecentSnapshots();

  return (
    <main data-testid="trends-page" className="mx-auto max-w-6xl xl:max-w-7xl px-4 py-8 pb-20 sm:px-8 sm:py-10 xl:px-10">
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

      {/* 2-Column Responsive Dashboard Layout */}
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left Column: Geographic & Work Flexibility */}
        <div className="space-y-6">
          <TopCountriesList countries={data.topCountries} />
          <WorkArrangementDistribution
            workTypes={data.workTypeDistribution}
            visaSponsorship={data.visaSponsorshipDistribution}
          />
          <PostingFreshnessBand freshness={data.freshness} />
        </div>

        {/* Right Column: Ghost Risk & Seniority & Pulse */}
        <div className="space-y-6">
          <MarketGhostRadar ghostRadar={data.ghostRadar} />
          <ExperienceSeniorityDistribution
            experienceLevels={data.experienceDistribution}
            employmentTypes={data.employmentTypeDistribution}
          />
          <MarketPulse
            postedPerDay={data.postedPerDay}
            liveJobs={data.liveJobs}
            closed={data.closed}
            staleActiveSharePct={data.staleActiveSharePct}
            sourceCoverage={data.sourceCoverage}
            snapshotSummary={<DailySnapshotSummary snapshots={snapshots} />}
          />
        </div>
      </div>
    </main>
  );
}

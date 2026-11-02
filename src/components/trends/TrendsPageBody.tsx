import { PageHeader } from "@/components/layout/PageHeader";
import { TrendsHero } from "@/components/trends/TrendsHero";
import { TopCountriesList } from "@/components/trends/TopCountriesList";
import { PostingFreshnessBand } from "@/components/trends/PostingFreshnessBand";
import { MarketGhostRadar } from "@/components/trends/MarketGhostRadar";
import { MarketPulse } from "@/components/trends/MarketPulse";
import { WorkArrangementDistribution } from "@/components/trends/WorkArrangementDistribution";
import { ExperienceSeniorityDistribution } from "@/components/trends/ExperienceSeniorityDistribution";
import type { MarketTrendsData } from "@/lib/jobs/market-trends";
import { computeLatestDelta, sinceLabel, type DailySnapshotDoc } from "@/lib/trends/daily-snapshot";

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
    <div className="rounded-panel border border-border bg-muted px-3 py-2">
      {delta && (
        <p data-testid="trends-pulse-delta" className="text-xs text-foreground">
          <span className="text-muted-foreground">Since {sinceLabel(delta.sinceDate, snapshots[snapshots.length - 1].date)}: </span>
          <span className="font-semibold">{delta.netActiveChange >= 0 ? "+" : ""}{delta.netActiveChange.toLocaleString()}</span>
          <span className="text-muted-foreground"> net active</span>
        </p>
      )}
      <p data-testid="trends-pulse-tracking-since" className="mt-0.5 text-xs text-muted-foreground">
        tracking daily baseline since {firstSnapshotDate}
      </p>
    </div>
  );
}

/**
 * The /trends page once its numbers are in hand. The page fetches them from the search index and the box database;
 * /mock/trends renders this same body over made-up numbers, so a cloud session (which reaches neither) can still
 * measure every row and line this page draws (journey J-MOB-33).
 */
export function TrendsPageBody({ data, snapshots }: { data: MarketTrendsData; snapshots: DailySnapshotDoc[] }) {
  return (
    <div data-testid="trends-page" className="shell-row page-top pb-20">
      <PageHeader
        bare
        title="Market trends"
        description="Live stats from the jobs corpus we track — from companies' own career pages, not curated."
        actions={
          <span className="text-xs text-muted-foreground">counts refresh every 15 minutes</span>
        }
      />

      <TrendsHero
        liveJobs={data.liveJobs}
        totalTracked={data.totalTracked}
        ghostFlaggedLive={data.ghostFlaggedLive}
      />

      {/* 2-Column Responsive Carbon BI Multi-Column Grid */}
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left Column: Flow Velocity, Geographic Reach, Lifecycle Age */}
        <div className="space-y-6">
          <MarketPulse
            postedPerDay={data.postedPerDay}
            liveJobs={data.liveJobs}
            closed={data.closed}
            staleActiveSharePct={data.staleActiveSharePct}
            sourceCoverage={data.sourceCoverage}
            snapshotSummary={<DailySnapshotSummary snapshots={snapshots} />}
          />
          <TopCountriesList countries={data.topCountries} />
          <PostingFreshnessBand freshness={data.freshness} />
        </div>

        {/* Right Column: Market Integrity, Workplace Flexibility, Seniority Mix */}
        <div className="space-y-6">
          <MarketGhostRadar ghostRadar={data.ghostRadar} />
          <WorkArrangementDistribution
            workTypes={data.workTypeDistribution}
            visaSponsorship={data.visaSponsorshipDistribution}
          />
          <ExperienceSeniorityDistribution
            experienceLevels={data.experienceDistribution}
            employmentTypes={data.employmentTypeDistribution}
          />
        </div>
      </div>
    </div>
  );
}

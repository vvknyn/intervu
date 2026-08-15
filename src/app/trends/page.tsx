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
//
// ITEM U (2026-08-15): matched to `getCachedMarketTrends`'s own 900s window
// (was 1800s, independently set). The data now comes from that ONE shared
// cache entry — every other consumer (TopBar's ticker, jobs/page.tsx's
// landing claim) reads it live on each mount, so this page's own outer ISR
// regen can be at most as stale as the shared cache itself, never stacking
// a second, longer staleness window on top of it. That stacking (page-shell
// regen slower than the data cache it embeds) was the second half of the
// 595-apart skew this fixes, not just the two-loaders half.
export const revalidate = 900;

export default async function TrendsPage() {
  const data = await getCachedMarketTrends().catch(() => null);

  if (!data) {
    return (
      <main data-testid="trends-page" className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <p className="text-sm text-muted-foreground">Market data isn&apos;t available right now.</p>
      </main>
    );
  }

  // Lazy daily snapshot (P2): create-if-absent off THIS fetch's numbers (no
  // extra Meili cost), never throws — see daily-snapshot.ts's module doc.
  //
  // Skipped entirely when the closed figure is unknown. The snapshot series
  // is differenced (`newlyClosed: latest.closed - prev.closed`), so a
  // placeholder 0 does not just mis-state one day — it corrupts the deltas
  // on BOTH sides of it. Losing a day is recoverable; a fabricated row in a
  // historical series is not.
  if (data.closed) {
    await captureDailySnapshotIfAbsent({
      totalDocs: data.totalTracked.value,
      active: data.liveJobs.value,
      closed: data.closed.closed,
    });
  }
  const snapshots = await readRecentSnapshots();

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
      <MarketPulse
        postedPerDay={data.postedPerDay}
        liveJobs={data.liveJobs}
        closed={data.closed}
        staleActiveSharePct={data.staleActiveSharePct}
        sourceCoverage={data.sourceCoverage}
        snapshotSummary={<DailySnapshotSummary snapshots={snapshots} />}
      />
    </main>
  );
}

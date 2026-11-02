import type { Metadata } from "next";
import { getCachedMarketTrends } from "@/lib/jobs/market-trends";
import { captureDailySnapshotIfAbsent, readRecentSnapshots } from "@/lib/trends/daily-snapshot";
import { TrendsPageBody } from "@/components/trends/TrendsPageBody";
import { canonicalMetadata } from "@/lib/seo/page-metadata";
import { GHOST_JOB_TERM } from "@/lib/seo/ghost-job-term";

// A plain `export const metadata` object can't carry the current month, so
// this is `generateMetadata` instead — computed at request/revalidation
// time (same cadence as the page's own `revalidate` below), never a
// hand-maintained date literal that goes stale.
export async function generateMetadata(): Promise<Metadata> {
  const asOf = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const title = "Market trends";
  const description = `Live ${GHOST_JOB_TERM} and hiring stats — hiring countries, posting freshness, ${GHOST_JOB_TERM} risk. Snapshot as of ${asOf}.`;
  return {
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
      <div data-testid="trends-page" className="shell-row page-top pb-10">
        <p className="text-sm text-muted-foreground">Market data isn&apos;t available right now.</p>
      </div>
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

  return <TrendsPageBody data={data} snapshots={snapshots} />;
}

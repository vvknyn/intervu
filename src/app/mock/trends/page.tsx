import type { Metadata } from "next";
import { TrendsPageBody } from "@/components/trends/TrendsPageBody";
import { UNCLASSIFIED_LABEL, type CountryRollupRow } from "@/lib/jobs/country-classification";
import type { CorpusCount } from "@/lib/jobs/corpus-count";
import type { MarketTrendsData, TrendFacetItem } from "@/lib/jobs/market-trends";
import type { DailySnapshotDoc } from "@/lib/trends/daily-snapshot";

export const metadata: Metadata = {
  title: "Trends mock",
};

/**
 * Fixture harness for /trends: the real `TrendsPageBody` over made-up numbers, so every row and line the page draws
 * (the bars, the workplace legend, the employment-type links, the "where these postings come from" line) renders on
 * a server that reaches neither the search index nor the box database. Without it a cloud session sees only "Market
 * data isn't available right now" and measures nothing (journey J-MOB-33). The numbers are the shape of the live
 * page: four employment types, eight sources. 404 in production (mock/layout.tsx).
 */
const exact = (value: number): CorpusCount => ({ kind: "exact", value });

function facet(rows: [raw: string, label: string, count: number][]): TrendFacetItem[] {
  const total = rows.reduce((sum, [, , count]) => sum + count, 0);
  return rows.map(([rawKey, label, count]) => ({ key: rawKey, rawKey, label, count, pct: Math.round((count / total) * 100) }));
}

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 1, 12, 0, 0);

function buildData(now: number): MarketTrendsData {
  const day = (back: number) => new Date(now - back * DAY).toISOString().slice(0, 10);
  const countries: CountryRollupRow[] = [
    { country: "United States", count: 612_400, rawValues: ["United States", "US", "USA"] },
    { country: "United Kingdom", count: 88_900, rawValues: ["United Kingdom", "UK"] },
    { country: "Canada", count: 61_300, rawValues: ["Canada"] },
    { country: "Germany", count: 44_100, rawValues: ["Germany"] },
    { country: "India", count: 39_800, rawValues: ["India"] },
    { country: UNCLASSIFIED_LABEL, count: 102_000, rawValues: undefined },
  ];
  return {
    liveJobs: exact(1_080_000),
    totalTracked: exact(1_540_000),
    ghostFlaggedLive: exact(61_000),
    topCountries: countries,
    freshness: [
      { bucket: "7d", count: exact(212_000) },
      { bucket: "30d", count: exact(371_000) },
      { bucket: "60d", count: exact(228_000) },
      { bucket: "older", count: exact(269_000) },
    ],
    ghostRadar: [
      { badge: "clear", count: exact(742_000) },
      { badge: "caution", count: exact(188_000) },
      { badge: "likely_ghost", count: exact(61_000) },
      { badge: "unscored", count: exact(89_000) },
    ],
    workTypeDistribution: facet([
      ["onsite", "On-site", 520_000],
      ["hybrid", "Hybrid", 290_000],
      ["remote", "Fully Remote", 270_000],
    ]),
    experienceDistribution: facet([
      ["senior", "Senior", 340_000],
      ["mid", "Mid-Level", 310_000],
      ["entry", "Entry & Junior", 190_000],
      ["lead", "Staff & Lead", 150_000],
      ["executive", "Executive & Director", 90_000],
    ]),
    employmentTypeDistribution: facet([
      ["full_time", "Full-Time", 780_000],
      ["contract", "Contract", 90_000],
      ["part_time", "Part-Time", 70_000],
      ["internship", "Internship", 60_000],
    ]),
    visaSponsorshipDistribution: { sponsoredCount: 54_000, sponsoredPct: 5, totalCount: 1_080_000 },
    closed: { windowDays: 90, closed: 402_000, opened: 455_000, livePostings: 1_080_000, companiesTracked: 21_400, sourceComputedAt: new Date(now - DAY).toISOString() },
    postedPerDay: Array.from({ length: 14 }, (_, i) => ({ date: day(13 - i), count: exact(9_000 + ((i * 3_700) % 11_000)) })),
    staleActiveSharePct: 25,
    sourceCoverage: [
      { source: "workday_direct", count: 306_258 },
      { source: "html_direct", count: 188_904 },
      { source: "greenhouse_direct", count: 141_002 },
      { source: "lever_direct", count: 90_112 },
      { source: "ashby_direct", count: 61_870 },
      { source: "smartrecruiters_direct", count: 48_330 },
      { source: "icims_direct", count: 33_190 },
      { source: "taleo_direct", count: 21_075 },
    ],
  };
}

function buildSnapshots(now: number): DailySnapshotDoc[] {
  return [3, 2, 1, 0].map((back, i) => {
    const date = new Date(now - back * DAY).toISOString().slice(0, 10);
    return { date, totalDocs: 1_500_000 + i * 12_000, active: 1_050_000 + i * 10_000, closed: 390_000 + i * 4_000, capturedAt: `${date}T01:00:00.000Z` };
  });
}

export default function MockTrendsPage() {
  return <TrendsPageBody data={buildData(NOW)} snapshots={buildSnapshots(NOW)} />;
}

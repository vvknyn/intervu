import type { Metadata } from "next";
import { CompanyPageBody } from "@/components/company/CompanyPageBody";
import { resolveCompanyIntelligence } from "@/lib/companies/enrichment";
import { buildWeeklyCadence, type CompanyExhaust } from "@/lib/companies/exhaust";
import { isoWeekStart } from "@/lib/companies/hiring-record";
import type { CompanyPageData } from "@/lib/companies/types";
import type { PublicJob } from "@/lib/jobs/types";

export const metadata: Metadata = {
  title: "Company page mock — Velai",
  robots: { index: false, follow: false },
};

const DAY = 86_400_000;

/**
 * Fixture harness for /co/[slug]: the real `CompanyPageBody` over a
 * made-up employer, so the page's full composition renders on a real server
 * without the search index or the box database (neither is reachable from a
 * cloud session). `?roles=0` shows the no-open-roles state, `?exhaust=0` a
 * company the box knows nothing about. 404 in production (mock/layout.tsx).
 */
function job(i: number, now: number, overrides: Partial<PublicJob>): PublicJob {
  return {
    id: `mock-${i}`,
    title: "Software Engineer",
    company: "Acme Robotics",
    company_domain: "acme-robotics.example",
    location: "Columbus, OH, United States",
    location_city: "Columbus",
    location_state: "OH",
    location_country: "United States",
    work_type: "onsite",
    description: null,
    employment_type: "full_time",
    experience_level: "mid",
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_period: null,
    visa_sponsorship: null,
    tags: [],
    apply_url: "https://example.com/apply",
    source: "mock",
    posted_at: new Date(now - (i * 4 + 2) * DAY).toISOString(),
    posted_ts: now - (i * 4 + 2) * DAY,
    first_seen_at: null,
    updated_at: null,
    vacancy_status: "open",
    ghost_badge: "clear",
    ghost_checked_at: new Date(now - (i % 3) * DAY).toISOString(),
    last_observed_alive_at: new Date(now - (i % 5) * 2 * DAY).toISOString(),
    ...overrides,
  };
}

const TITLES: [string, Partial<PublicJob>][] = [
  ["Robotics Software Engineer", { experience_level: "senior", salary_min: 130_000, salary_max: 170_000, salary_currency: "USD", salary_period: "yearly", visa_sponsorship: true }],
  ["Machine Learning Engineer, Perception", { experience_level: "senior", salary_min: 150_000, salary_max: 190_000, salary_currency: "USD", salary_period: "yearly" }],
  ["Welding Process Engineer", { salary_min: 95_000, salary_max: 120_000, salary_currency: "USD", salary_period: "yearly" }],
  ["Field Service Technician", { experience_level: "entry", salary_min: 28, salary_max: 34, salary_currency: "USD", salary_period: "hourly" }],
  ["Senior Controls Engineer", { experience_level: "senior", work_type: "Remote", location: "Remote, United States", location_city: null, location_state: null }],
  ["Product Manager, Autonomy", { salary_min: 140_000, salary_max: 175_000, salary_currency: "USD", salary_period: "yearly", visa_sponsorship: true }],
  ["Manufacturing Technician", { experience_level: "entry", ghost_badge: "likely_ghost" }],
  ["Remote Sensing Engineer", { experience_level: "mid" }],
  ["Account Executive", { work_type: "Remote", location: "Remote, United States", location_city: null, location_state: null, salary_min: 110_000, salary_max: 150_000, salary_currency: "USD", salary_period: "yearly" }],
  ["Staff Software Engineer, Simulation", { experience_level: "lead", salary_min: 180_000, salary_max: 230_000, salary_currency: "USD", salary_period: "yearly" }],
  ["Quality Engineer", {}],
  ["Technical Recruiter", {}],
];

function fixture(now: number, withRoles: boolean, withExhaust: boolean): CompanyPageData {
  const jobs = withRoles
    ? TITLES.map(([title, o], i) => job(i, now, { title, ...o }))
    : [];
  const trackedSince = new Date(now - 38 * DAY).toISOString().slice(0, 10);
  const trackedWeek = Date.parse(`${isoWeekStart(Date.parse(trackedSince))}T00:00:00Z`);
  const weekSums = [0, 1, 2, 3, 4, 5].map((w) => ({
    weekStartIso: new Date(trackedWeek + w * 7 * DAY).toISOString().slice(0, 10),
    newListings: [31, 2, 0, 4, 1, 1][w],
  }));
  const section = <T,>(data: T, source: string, label: string) => ({ data, source, label, asOf: new Date(now - 7 * DAY).toISOString() });
  const exhaust: CompanyExhaust = {
    profile: section(
      { tagline: null, homepageUri: null, hqCountry: "United States", industries: [], yearFounded: 2014, organizationType: "Private", nbEmployees: "201-500", parentCompany: null, atsHint: null, totalJobs: null },
      "company_enrichment",
      "Company profile",
    ),
    funding: section({ latestFundingAmount: 100_000_000, latestFundingType: "series_c", latestFundingYear: 2023, formDCount: 2, formDDates: [] }, "company_enrichment", "SEC Form D"),
    secListing: null,
    govContracts: section({ agencies: ["Department of Defense"], awardCount: 3, latestAward: null, totalAmount: 4_200_000 }, "company_enrichment", "USAspending"),
    h1bLca: null,
    warnNotices: null,
    health: section({ verdict: "actively_hiring", score: 88, repostRate: 0.08, operatingStatus: "active", observedSinceIso: new Date(now - 120 * DAY).toISOString() }, "company_health_reviews", "Company health review"),
    cadence: section({ weeks: buildWeeklyCadence(weekSums, now, 13, trackedSince), trackedSinceIso: trackedSince }, "company_posting_daily", "Posting activity"),
    integrity: section(
      { closedReasonCounts: [{ reason: "filled", label: "Filled", count: 5 }, { reason: "expired", label: "Expired", count: 2 }], openedCount: 9, trackedSinceIso: trackedSince },
      "job_listings",
      "Job listings",
    ),
    techStack: section({ groups: ["Analytics", "CMS"], techTier: "mid", totalLiveTechs: 23, totalDeadTechs: 4, hasFramework: true, hasAnalytics: true }, "company_enrichment", "Tech profile"),
    changeHistory: null,
  };
  return {
    domain: "acme-robotics.example",
    slug: "acme-robotics--example",
    name: "Acme Robotics",
    nameSource: "corpus-cased",
    oneLiner: "Robotic welding systems for heavy manufacturing.",
    stage: "Series C",
    opened90d: null,
    closed90d: null,
    hasTrackRecord: false,
    openCount: jobs.length,
    openCountIsLowerBound: false,
    ghostFlaggedPct: jobs.length ? Math.round((1 / jobs.length) * 100) : null,
    jobs,
    boards: [],
    intelligence: resolveCompanyIntelligence(jobs, "Series C", []),
    changeEvents: [
      { event_type: "hiring_accelerating", direction: "improving", headline: "New postings rose from 3 to 9 across two 14-day windows", occurred_at: new Date(now - 5 * DAY).toISOString(), confidence: 0.8 },
    ],
    exhaust: withExhaust ? exhaust : null,
    nowMs: now,
  };
}

export default async function CompanyPageMock({
  searchParams,
}: {
  searchParams: Promise<{ roles?: string; exhaust?: string }>;
}) {
  const { roles, exhaust } = await searchParams;
  // A fixture page, rendered per request: the clock only dates the made-up roles.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const data = fixture(now, roles !== "0", exhaust !== "0");
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-background">
      <CompanyPageBody data={data} signedIn={false} now={now} />
    </div>
  );
}

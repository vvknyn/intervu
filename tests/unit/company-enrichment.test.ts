import test, { mock } from "node:test";
import assert from "node:assert/strict";
import {
  deriveCompanyTechStack,
  deriveWorkModeDistribution,
  deriveCompanyFunding,
  deriveVisaIntelligence,
  resolveCompanyIntelligence,
} from "@/lib/companies/enrichment";
import { fetchCompanyNews } from "@/lib/companies/news";
import type { PublicJob } from "@/lib/jobs/types";

function makeTestJob(partial: Partial<PublicJob>): PublicJob {
  return {
    id: "job-1",
    title: "Senior Software Engineer",
    company: "Acme",
    company_domain: "acme.com",
    location: "San Francisco, CA",
    location_city: "San Francisco",
    location_state: "CA",
    location_country: "US",
    work_type: "remote",
    description: "Looking for an engineer with TypeScript, React, Python and AWS experience.",
    employment_type: "full_time",
    experience_level: "senior",
    salary_min: 150000,
    salary_max: 200000,
    salary_currency: "USD",
    salary_period: "year",
    visa_sponsorship: true,
    tags: ["typescript", "react", "aws", "postgresql"],
    apply_url: "https://acme.com/careers/1",
    source: "greenhouse",
    posted_at: "2026-08-01T00:00:00Z",
    first_seen_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    vacancy_status: "open",
    ghost_badge: "clear",
    ...partial,
  };
}

test("deriveCompanyTechStack extracts languages, frameworks, and infra correctly", () => {
  const jobs = [
    makeTestJob({ tags: ["typescript", "python"], description: "Docker and Kubernetes on AWS" }),
    makeTestJob({ tags: ["rust", "typescript"], description: "PostgreSQL and PyTorch for machine learning" }),
  ];

  const stack = deriveCompanyTechStack(jobs);
  assert.ok(stack !== null);
  assert.ok(stack.languages.includes("TypeScript"));
  assert.ok(stack.languages.includes("Python") || stack.languages.includes("Rust"));
  assert.ok(stack.infrastructure.includes("AWS") || stack.infrastructure.includes("Kubernetes"));
  assert.ok(stack.aiMlTools.includes("PyTorch"));
});

test("deriveCompanyTechStack returns null on empty job list", () => {
  assert.equal(deriveCompanyTechStack([]), null);
});

test("deriveWorkModeDistribution computes remote, hybrid, and onsite percentages", () => {
  const jobs = [
    makeTestJob({ work_type: "remote" }),
    makeTestJob({ work_type: "remote" }),
    makeTestJob({ work_type: "hybrid" }),
    makeTestJob({ work_type: "onsite" }),
  ];

  const modes = deriveWorkModeDistribution(jobs);
  assert.ok(modes !== null);
  assert.equal(modes.remotePct, 50);
  assert.equal(modes.hybridPct, 25);
  assert.equal(modes.onsitePct, 25);
  assert.equal(modes.remoteCount, 2);
  assert.equal(modes.total, 4);
});

test("deriveWorkModeDistribution reads work_type only — 'remote' in a title or location is not a remote role", () => {
  const jobs = [
    makeTestJob({ work_type: "onsite", title: "Remote Sensing Engineer" }),
    makeTestJob({ work_type: "onsite", location: "Remote, US" }),
    makeTestJob({ work_type: "Remote" }),
    makeTestJob({ work_type: "Hybrid" }),
  ];
  const modes = deriveWorkModeDistribution(jobs);
  assert.ok(modes !== null);
  assert.equal(modes.remoteCount, 1);
  assert.equal(modes.hybridPct, 25);
  assert.equal(modes.onsitePct, 50);
});

// Regression coverage for the fabrication removal: no domain, however
// well-known, gets a curated funding/visa answer any more — the only
// input that can produce a non-null result is real data (a job-listing
// stage string, or a real visa_sponsorship flag on a real job).

test("deriveCompanyFunding passes through the real job-listing stage for ANY domain, curated or not", () => {
  // Previously "stripe.com" resolved to a hand-typed $8.7B/investor-list
  // fixture regardless of `stage`. Now every domain is treated identically.
  const stripe = deriveCompanyFunding("Series C");
  assert.ok(stripe !== null);
  assert.equal(stripe.stage, "Series C");
  assert.equal(stripe.totalRaisedText, null);
  assert.equal(stripe.valuationText, null);
  assert.deepEqual(stripe.investors, []);

  const randomDomain = deriveCompanyFunding("Series A");
  assert.ok(randomDomain !== null);
  assert.equal(randomDomain.stage, "Series A");
  assert.equal(randomDomain.totalRaisedText, null);
});

test("deriveCompanyFunding returns null when stage is null or blank", () => {
  assert.equal(deriveCompanyFunding(null), null);
  assert.equal(deriveCompanyFunding(""), null);
  assert.equal(deriveCompanyFunding("   "), null);
});

test("deriveVisaIntelligence computes a sponsorship ratio from real job flags for ANY domain", () => {
  // Previously "stripe.com" resolved to a hand-typed 384-filing/98.6%
  // DOL benchmark. Now h1bFilingsCount/approvalRatePct are always null —
  // the only real signal is the ratio of this company's own listings
  // that carry visa_sponsorship === true.
  const jobs = [makeTestJob({ visa_sponsorship: true }), makeTestJob({ visa_sponsorship: false })];
  const visa = deriveVisaIntelligence(jobs);
  assert.ok(visa !== null);
  assert.equal(visa.h1bFilingsCount, null);
  assert.equal(visa.approvalRatePct, null);
  assert.equal(visa.permSponsored, false);
  assert.deepEqual(visa.topSponsoredRoles, []);
  assert.equal(visa.sponsoredRolesRatioPct, 50);
});

test("deriveVisaIntelligence returns null when no job on the company carries visa_sponsorship", () => {
  const jobs = [makeTestJob({ visa_sponsorship: false }), makeTestJob({ visa_sponsorship: null })];
  assert.equal(deriveVisaIntelligence(jobs), null);
  assert.equal(deriveVisaIntelligence([]), null);
});

test("resolveCompanyIntelligence for a company with zero jobs, no stage, and no news returns the honest-empty shape", () => {
  const intel = resolveCompanyIntelligence([], null, []);
  assert.deepEqual(intel, {
    funding: null,
    visa: null,
    techStack: null,
    workModes: null,
    news: [],
  });
});

test("resolveCompanyIntelligence passes real news articles through untouched", () => {
  const jobs = [makeTestJob({})];
  const news = [
    {
      title: "Acme raises Series C",
      url: "https://example.com/acme-series-c",
      summary: "A real article summary.",
      publisher: "Example Wire",
      published_at: "2026-08-01",
      is_funding_event: true,
      confidence: "high" as const,
    },
  ];
  const intel = resolveCompanyIntelligence(jobs, "Series C", news);
  assert.equal(intel.funding?.stage, "Series C");
  assert.deepEqual(intel.news, news);
});

test("fetchCompanyNews fails soft to [] on a non-2xx response (e.g. the endpoint not deployed yet)", async () => {
  const prevKey = process.env.SUBSPACE_API_KEY;
  process.env.SUBSPACE_API_KEY = "test-key";
  mock.method(globalThis, "fetch", async () => ({ ok: false, status: 404 }) as Response);

  try {
    const articles = await fetchCompanyNews("acme.com");
    assert.deepEqual(articles, []);
  } finally {
    mock.reset();
    process.env.SUBSPACE_API_KEY = prevKey;
  }
});

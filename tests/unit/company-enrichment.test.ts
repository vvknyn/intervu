import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveCompanyTechStack,
  deriveWorkModeDistribution,
  deriveCompanyFunding,
  deriveVisaIntelligence,
  deriveCompanyLayoffInfo,
  deriveCompanySignals,
  deriveCompanyNews,
  resolveCompanyIntelligence,
} from "@/lib/companies/enrichment";
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
});

test("deriveCompanyFunding resolves curated venture info for known companies", () => {
  const stripe = deriveCompanyFunding("stripe.com", "Stripe", null);
  assert.ok(stripe !== null);
  assert.equal(stripe.totalRaisedText, "$8.7B Total Raised");
  assert.ok(stripe.investors.includes("Sequoia Capital"));
  assert.ok(stripe.investors.includes("Founders Fund"));

  const openai = deriveCompanyFunding("openai.com", "OpenAI", null);
  assert.ok(openai !== null);
  assert.equal(openai.totalRaisedText, "$17.9B Total Raised");

  const unbacked = deriveCompanyFunding("random-domain.com", "Random", "Series A");
  assert.ok(unbacked !== null);
  assert.equal(unbacked.stage, "Series A");
  assert.equal(unbacked.totalRaisedText, null);
});

test("deriveVisaIntelligence resolves US DOL filings for top tech employers and computes ratios", () => {
  const jobs = [makeTestJob({ visa_sponsorship: true }), makeTestJob({ visa_sponsorship: false })];
  const visa = deriveVisaIntelligence("stripe.com", jobs);
  assert.ok(visa !== null);
  assert.equal(visa.h1bFilingsCount, 384);
  assert.equal(visa.approvalRatePct, 98.6);
  assert.equal(visa.permSponsored, true);
  assert.ok(visa.topSponsoredRoles.length > 0);

  const genericVisa = deriveVisaIntelligence("genericcompany.com", jobs);
  assert.ok(genericVisa !== null);
  assert.equal(genericVisa.sponsoredRolesRatioPct, 50);
});

test("deriveCompanyLayoffInfo tracks WARN act notice status", () => {
  const stripeLayoffs = deriveCompanyLayoffInfo("stripe.com", "Stripe", [makeTestJob({})]);
  assert.ok(stripeLayoffs !== null);
  assert.equal(stripeLayoffs.warnNoticeCount, 0);
  assert.equal(stripeLayoffs.riskLevel, "low");

  const generic = deriveCompanyLayoffInfo("acme.com", "Acme", [makeTestJob({}), makeTestJob({}), makeTestJob({})]);
  assert.ok(generic !== null);
  assert.equal(generic.warnNoticeCount, 0);
});

test("deriveCompanyNews surfaces curated press coverage and fallback ATS news", () => {
  const openaiNews = deriveCompanyNews("openai.com", "OpenAI", "Late Stage", [makeTestJob({})]);
  assert.ok(openaiNews.length >= 2);
  assert.ok(openaiNews.some((n) => n.source === "TechCrunch" || n.source === "Bloomberg"));

  const fallbackNews = deriveCompanyNews("random.com", "Random", "Seed", [makeTestJob({})]);
  assert.ok(fallbackNews.length >= 1);
});

test("resolveCompanyIntelligence integrates all pillars cleanly", () => {
  const jobs = [makeTestJob({})];
  const intel = resolveCompanyIntelligence("stripe.com", "Stripe", jobs, "Late Stage");
  assert.ok(intel.funding !== null);
  assert.ok(intel.visa !== null);
  assert.ok(intel.techStack !== null);
  assert.ok(intel.workModes !== null);
  assert.ok(intel.layoffs !== null);
  assert.ok(intel.signals.length > 0);
  assert.ok(intel.news.length > 0);
});

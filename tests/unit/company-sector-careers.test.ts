import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveBoardRoot, pickBoardRoot } from "../../src/lib/companies/careers-board-root";
import { categoryLabel } from "../../src/lib/companies/machine-token";
import { resolveCareersUrl, resolveSector } from "../../src/lib/companies/exhaust";

describe("deriveBoardRoot: one real posting URL per ATS", () => {
  const cases: Array<[string, string]> = [
    ["https://boards.greenhouse.io/stripe/jobs/5710291003", "https://boards.greenhouse.io/stripe"],
    ["https://job-boards.greenhouse.io/anthropic/jobs/4020159008", "https://job-boards.greenhouse.io/anthropic"],
    ["https://jobs.lever.co/netflix/6a5b1c6e-2d3f-4b8a-9c1d-0e7f8a9b0c1d", "https://jobs.lever.co/netflix"],
    ["https://jobs.ashbyhq.com/ramp/1f2e3d4c-5b6a-7988-aabb-ccddeeff0011", "https://jobs.ashbyhq.com/ramp"],
    ["https://jobs.smartrecruiters.com/Visa/743999876543210-software-engineer", "https://jobs.smartrecruiters.com/visa"],
    ["https://apply.workable.com/acme-inc/j/ABCDEF1234/", "https://apply.workable.com/acme-inc"],
    ["https://acme.bamboohr.com/careers/42", "https://acme.bamboohr.com/careers"],
    ["https://acme.teamtailor.com/jobs/1234567-backend-developer", "https://acme.teamtailor.com/jobs"],
    ["https://pfizer.wd1.myworkdayjobs.com/en-US/PfizerCareers/job/New-York/Engineer_R123", "https://pfizer.wd1.myworkdayjobs.com/PfizerCareers"],
    ["https://pfizer.wd1.myworkdayjobs.com/PfizerCareers/job/New-York/Engineer_R123", "https://pfizer.wd1.myworkdayjobs.com/PfizerCareers"],
    ["https://careers-acme.icims.com/jobs/1234/software-engineer/job", "https://careers-acme.icims.com/jobs"],
  ];
  for (const [posting, root] of cases) it(posting, () => assert.equal(deriveBoardRoot(posting)?.root, root));

  it("unrecognised host, vendor-level path, or non-URL gives null", () => {
    for (const bad of ["https://acme.com/careers/senior-engineer-1234", "https://www.linkedin.com/jobs/view/3912345678", "https://boards.greenhouse.io/embed/job_app?token=1", "https://apply.workable.com/j/ABC123", "https://jobs.lever.co/", "https://jobs.ashbyhq.com/", "https://www.bamboohr.com/careers/1", "javascript:alert(1)", "not a url"])
      assert.equal(deriveBoardRoot(bad), null, bad);
  });
});

describe("resolveCareersUrl", () => {
  const posting = "https://boards.greenhouse.io/stripe/jobs/5710291003";
  it("a good stored URL wins over the derived root", () => {
    assert.equal(resolveCareersUrl({ careers_url: "https://acme.com/careers", last_scrape_outcome: "EMPTY_BOARD", listing_urls: [posting], domain: "stripe.com" }), "https://acme.com/careers");
  });
  it("explored with EMPTY_BOARD (a real page, no jobs) or a transient error keeps the stored URL", () => {
    for (const last_scrape_outcome of ["EMPTY_BOARD", "ERROR_TIMEOUT"])
      assert.equal(resolveCareersUrl({ careers_url: "https://acme.com/careers", last_scrape_outcome, listing_urls: [posting], domain: "stripe.com" }), "https://acme.com/careers");
  });
  it("an outcome saying the URL is unusable hides it and the derived root shows", () => {
    for (const last_scrape_outcome of ["CAREER_PAGE_CORPORATE", "URL_DEAD_404", "CAREER_PAGE_JUNK", "SITE_PARKED"])
      assert.equal(resolveCareersUrl({ careers_url: "https://acme.com/blog", last_scrape_outcome, listing_urls: [posting], domain: "stripe.com" }), "https://boards.greenhouse.io/stripe");
  });
  it("a stored ATS API endpoint is hidden; null when nothing derivable", () => {
    for (const api of ["https://boards-api.greenhouse.io/v1/boards/stripe/jobs", "https://api.lever.co/v0/postings/netflix", "https://jobs.ashbyhq.com/api/non-user-graphql"])
      assert.equal(resolveCareersUrl({ careers_url: api, last_scrape_outcome: "EMPTY_BOARD", listing_urls: null, domain: "stripe.com" }), null);
  });
  it("a human careers page whose path merely has a version segment is shown", () => {
    for (const url of ["https://phh.tbe.taleo.net/phh04/ats/careers/v2/jobSearch?org=DCSCORP2&cws=37", "https://careers.example.com/v3/openings"])
      assert.equal(resolveCareersUrl({ careers_url: url, last_scrape_outcome: "EMPTY_BOARD", listing_urls: null, domain: "example.com" }), url);
  });
  it("a URL stored beside REACHABLE_NO_CAREER_PAGE / UNSCRAPABLE_NO_URL was never confirmed: the derived root shows", () => {
    for (const last_scrape_outcome of ["REACHABLE_NO_CAREER_PAGE", "UNSCRAPABLE_NO_URL"])
      assert.equal(resolveCareersUrl({ careers_url: "https://acme.com/careers", last_scrape_outcome, listing_urls: [posting], domain: "stripe.com" }), "https://boards.greenhouse.io/stripe");
  });
  it("a tenantless ATS vendor URL is hidden; tenant-bearing and own-domain URLs are shown", () => {
    for (const hidden of ["https://boards.greenhouse.io/", "https://jobs.lever.co", "https://acme.wd1.myworkdayjobs.com/"])
      assert.equal(resolveCareersUrl({ careers_url: hidden, listing_urls: null, domain: "acme.com" }), null, hidden);
    for (const shown of ["https://jobs.smartrecruiters.com/eurofins", "https://boards.greenhouse.io/acme", "https://acme.wd1.myworkdayjobs.com/External", "https://careers.acme.com"])
      assert.equal(resolveCareersUrl({ careers_url: shown, listing_urls: null, domain: "acme.com" }), shown);
  });
  it("no stored URL derives from the listing; an unknown host or a lone posting is never shown", () => {
    assert.equal(resolveCareersUrl({ careers_url: null, listing_urls: ["https://acme.bamboohr.com/careers/42"], domain: "acme.com" }), "https://acme.bamboohr.com/careers");
    assert.equal(resolveCareersUrl({ careers_url: null, listing_urls: ["https://acme.com/jobs/engineer-12"], domain: "acme.com" }), null);
  });
});

describe("pickBoardRoot", () => {
  it("a tenant-less Workable posting and another employer's Workday tenant give null", () => {
    assert.equal(pickBoardRoot(["https://apply.workable.com/j/ABC123"], "acme.com"), null);
    assert.equal(pickBoardRoot(["https://wustl.wd1.myworkdayjobs.com/en-US/WashingtonUniversityCareers/job/St-Louis/Analyst_R1"], "atdstl.org"), null);
  });
  it("the same class on other ATSes: another employer's greenhouse/lever slug, or a mismatched tenant, is no evidence", () => {
    assert.equal(pickBoardRoot(["https://boards.greenhouse.io/someoneelse/jobs/1"], "stripe.com"), null);
    assert.equal(pickBoardRoot(["https://jobs.lever.co/netflix/6a5b1c6e-2d3f-4b8a-9c1d-0e7f8a9b0c1d"], "stripe.com"), null);
    assert.equal(pickBoardRoot(["https://acme.bamboohr.com/careers/42"], "acme.com"), "https://acme.bamboohr.com/careers");
  });
  it("mixed tenants: the agreeing majority wins, ties go to the newest", () => {
    const stripe = "https://boards.greenhouse.io/stripe/jobs/1";
    const other = "https://boards.greenhouse.io/stripeoutsource/jobs/2";
    const lever = "https://jobs.lever.co/stripe/6a5b1c6e-2d3f-4b8a-9c1d-0e7f8a9b0c1d";
    assert.equal(pickBoardRoot([lever, stripe, "https://wustl.wd1.myworkdayjobs.com/Careers/job/x", stripe], "stripe.com"), "https://boards.greenhouse.io/stripe");
    assert.equal(pickBoardRoot([lever, stripe], "stripe.com"), "https://jobs.lever.co/stripe");
    assert.equal(pickBoardRoot([stripe, lever], "stripe.com"), "https://boards.greenhouse.io/stripe");
  });
});

describe("resolveSector with profile industries", () => {
  it("uses the first non-generic industry", () => {
    assert.equal(resolveSector(["General", "Financial Services", "Software"]), "Financial Services");
  });
  it("never shows general; null when nothing real remains", () => {
    assert.equal(resolveSector(["general", "unknown"]), null);
    assert.equal(resolveSector(), null);
  });
});

describe("categoryLabel: one display rule for every categorical company label", () => {
  const cases: Array<[string, string]> = [
    ["healthcare", "Healthcare"],
    ["energy", "Energy"],
    ["financial services", "Financial Services"],
    ["big_tech", "Big Tech"],
    ["ai-infra", "AI Infra"],
    ["ai_ml", "AI ML"],
    ["enterprise_saas", "Enterprise SaaS"],
    ["ml_ops", "ML Ops"],
    ["retail_chain", "Retail Chain"],
    ["climate_energy", "Climate Energy"],
    ["Industrial Automation", "Industrial Automation"],
    ["IT Services", "IT Services"],
    ["R&D", "R&D"],
  ];
  for (const [raw, shown] of cases) it(`${raw} -> ${shown}`, () => assert.equal(categoryLabel(raw), shown));

  it("resolveSector shows a raw lowercase source value the same way", () => {
    for (const [raw, shown] of cases) assert.equal(resolveSector([raw]), shown);
  });

  it("a profile industry dedupes against the sector through the same rule", () => {
    const sector = resolveSector(["healthcare"]);
    assert.deepEqual(["healthcare", "biotech"].map(categoryLabel).filter((x) => x !== sector), ["Biotech"]);
  });
});

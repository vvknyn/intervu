import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  domainRetrievalBias,
  filterHitsByDomainFilters,
  jobMatchesDomainFilters,
  postFilterSearchQ,
  resetCompanyDomainFilterSupportForTests,
} from "../../src/lib/jobs/meilisearch";
import type { PublicJob } from "../../src/lib/jobs/types";

function job(overrides: Partial<PublicJob> & Pick<PublicJob, "id">): PublicJob {
  return {
    title: "Engineer",
    company: "Acme",
    company_domain: null,
    location: null,
    location_city: null,
    location_state: null,
    location_country: null,
    work_type: "remote",
    description: null,
    employment_type: "full_time",
    experience_level: "mid",
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_period: null,
    visa_sponsorship: null,
    tags: [],
    apply_url: "https://example.com",
    source: "test",
    posted_at: null,
    first_seen_at: null,
    updated_at: null,
    vacancy_status: "open",
    ghost_badge: "clear",
    ...overrides,
  };
}

describe("jobMatchesDomainFilters", () => {
  it("passes when no domain filters set", () => {
    assert.equal(jobMatchesDomainFilters(job({ id: "1", company_domain: "other.com" }), {}), true);
  });

  it("matches companyDomain case-insensitively with trim", () => {
    const j = job({ id: "1", company_domain: "Stripe.COM" });
    assert.equal(jobMatchesDomainFilters(j, { companyDomain: "  stripe.com " }), true);
    assert.equal(jobMatchesDomainFilters(j, { companyDomain: "notion.so" }), false);
  });

  it("matches board allowlist membership", () => {
    const j = job({ id: "1", company_domain: "anthropic.com" });
    assert.equal(jobMatchesDomainFilters(j, { board: "elite" }), true);
    assert.equal(jobMatchesDomainFilters(job({ id: "2", company_domain: "unknown.test" }), { board: "elite" }), false);
  });
});

describe("filterHitsByDomainFilters", () => {
  it("returns all hits when no domain filters", () => {
    const hits = [job({ id: "1" }), job({ id: "2", company_domain: "x.com" })];
    assert.deepEqual(filterHitsByDomainFilters(hits, {}), hits);
  });

  it("filters to matching domains", () => {
    const hits = [
      job({ id: "1", company_domain: "stripe.com" }),
      job({ id: "2", company_domain: "notion.so" }),
    ];
    const out = filterHitsByDomainFilters(hits, { companyDomain: "stripe.com" });
    assert.deepEqual(out.map((h) => h.id), ["1"]);
  });
});

describe("postFilterSearchQ", () => {
  it("uses domain label bias for company-only browse", () => {
    assert.equal(postFilterSearchQ({ companyDomain: "stripe.com" }), "stripe");
  });

  it("keeps explicit query text", () => {
    assert.equal(postFilterSearchQ({ q: "backend", companyDomain: "stripe.com" }), "backend");
  });

  it("does not bias when board is set", () => {
    assert.equal(postFilterSearchQ({ board: "elite", companyDomain: "stripe.com" }), "");
  });
});

describe("domainRetrievalBias", () => {
  it("strips TLD from domain", () => {
    assert.equal(domainRetrievalBias("stripe.com"), "stripe");
    assert.equal(domainRetrievalBias("sub.example.co.uk"), "sub");
  });
});

describe("resetCompanyDomainFilterSupportForTests", () => {
  it("is callable without throwing", () => {
    resetCompanyDomainFilterSupportForTests();
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { toSectionItem } from "@/lib/email/digest/collect";
import type { PublicJob } from "@/lib/jobs/types";

function job(overrides: Partial<PublicJob> = {}): PublicJob {
  return {
    id: "job-1",
    title: "Software Engineer",
    company: "Acme Co",
    company_domain: "acme.com",
    location: "Remote",
    location_city: null,
    location_state: null,
    location_country: "US",
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
    apply_url: "https://acme.com/apply/job-1",
    source: "greenhouse_direct",
    posted_at: null,
    first_seen_at: null,
    updated_at: null,
    vacancy_status: "open",
    ghost_badge: "unscored",
    ...overrides,
  };
}

// Company-name seam rework (2026-08-29): the index carries the ATS-stated
// raw name (intervu owns display-time cleaning, not ingest — a separate
// repo writes the live index and PUTs the feed through unchanged), so the
// digest's `item.company` used to print straight into a sent email.
// Cleaner-algorithm coverage lives in jobs-company-clean.test.ts — these
// prove this chokepoint (every digest lane — followed/tracked-company,
// saved-search, default — funnels through it) actually calls it.
describe("toSectionItem", () => {
  it("cleans a raw ATS-stated company name before it reaches the digest", () => {
    const item = toSectionItem(job({ company: "REQ123 Acme Co" }), "https://intervuhq.com");
    assert.equal(item.company, "Acme Co");
  });

  it("falls back to 'Unknown company' rather than a blank string when both company and domain are absent", () => {
    const item = toSectionItem(job({ company: null, company_domain: null }), "https://intervuhq.com");
    assert.equal(item.company, "Unknown company");
  });
});

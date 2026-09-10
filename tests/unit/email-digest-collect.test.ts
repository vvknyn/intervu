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

  // E3: this email has no separate work-type chip (unlike the SERP/detail
  // panes), so it's the only place a remote/hybrid job's work mode shows up
  // at all — toSectionItem folds it onto the place via placeWithWorkMode.
  it("a remote job with a real place renders the place and the mode as two segments", () => {
    const item = toSectionItem(
      job({ location: null, location_city: "Milan", location_state: null, location_country: "Italy" }),
      "https://intervuhq.com",
    );
    assert.equal(item.location, "Milan, Italy · Remote");
  });

  // Class case, not just the motivating one: a job with NO structured place
  // (locationText's own bare-word fallback, exactly the default fixture
  // above) must not double up into "Remote · Remote".
  it("a remote job with no place at all still reads as a single 'Remote', not a doubled one", () => {
    const item = toSectionItem(job(), "https://intervuhq.com");
    assert.equal(item.location, "Remote");
  });
});

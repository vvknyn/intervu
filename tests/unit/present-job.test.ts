import { test } from "node:test";
import assert from "node:assert/strict";
import { presentJob } from "../../src/lib/presentation/job";
import type { PublicJob } from "../../src/lib/jobs/types";

function job(overrides: Partial<PublicJob> = {}): PublicJob {
  return {
    id: "test",
    title: "Engineer",
    company: "Acme Robotics",
    company_domain: "acme.com",
    location: null,
    location_city: null,
    location_state: null,
    location_country: null,
    work_type: "unknown",
    description: null,
    employment_type: "unknown",
    experience_level: "unknown",
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_period: null,
    visa_sponsorship: null,
    tags: [],
    apply_url: "https://example.com/apply",
    source: "test",
    posted_at: null,
    first_seen_at: null,
    updated_at: null,
    vacancy_status: "open",
    ghost_badge: "unscored",
    ...overrides,
  };
}

test("composes company, location, and description through the shared helpers", () => {
  const out = presentJob(
    job({
      title: "Software Engineer",
      company: "acme.workable.com",
      company_domain: "acme.com",
      location: "Waterloo, Ontario, CAN, N2L 0A1",
      description: "Job Requisition ID #26WD99545 English posting follows. We build reliable systems.",
      salary_min: 120_000,
      salary_max: 150_000,
      salary_currency: "USD",
      salary_period: "year",
    }),
  );
  assert.equal(out.title, "Software Engineer");
  assert.equal(out.company.name, "Acme");
  assert.equal(out.location, "Waterloo, Ontario, CAN");
  assert.equal(out.descriptionLede, "We build reliable systems.");
  assert.equal(out.salary, "USD 120k–150k/yr");
});

test("status is null for an unscored job — never fabricates a verdict", () => {
  const out = presentJob(job({ ghost_badge: "unscored" }));
  assert.equal(out.status, null);
});

test("status carries the seeker-facing 'review' word for a caution-flagged job", () => {
  const out = presentJob(job({ ghost_badge: "caution" }));
  assert.equal(out.status?.label, "Worth verifying");
});

test("status carries the seeker-facing word for a likely-ghost job", () => {
  const out = presentJob(job({ ghost_badge: "likely_ghost" }));
  assert.equal(out.status?.label, "Possibly stale");
});

test("salary is null when the corpus carries no salary figures", () => {
  const out = presentJob(job());
  assert.equal(out.salary, null);
});

test("collapses a 40-state remote list to 'Remote (US)'", () => {
  const states = ["AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID"];
  const out = presentJob(job({ location: states.map((s) => `Remote - ${s}`).join("; "), work_type: "remote" }));
  assert.equal(out.location, "Remote (US)");
});

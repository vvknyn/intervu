import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveCompanyStats } from "../../src/lib/companies/company-stats";
import type { PublicJob } from "../../src/lib/jobs/types";

const NOW = Date.parse("2026-08-01T12:00:00Z");
const DAY_MS = 86_400_000;

function job(overrides: Partial<PublicJob>): PublicJob {
  return {
    id: overrides.id ?? Math.random().toString(36),
    title: "Software Engineer",
    company: "Acme Corp",
    company_domain: "acme.com",
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
    source: "greenhouse_direct",
    posted_at: null,
    first_seen_at: null,
    posted_ts: null,
    updated_at: null,
    vacancy_status: "active",
    ghost_badge: "unscored",
    ...overrides,
  };
}

describe("deriveCompanyStats", () => {
  it("empty hit set: zero total, every bucket present at zero (no silent gaps)", () => {
    const stats = deriveCompanyStats([], NOW);
    assert.equal(stats.totalOpenRoles, 0);
    assert.deepEqual(
      stats.ghostMix.map((r) => r.count),
      [0, 0, 0, 0],
    );
    assert.deepEqual(
      stats.freshness.map((r) => r.count),
      [0, 0, 0, 0],
    );
  });

  it("falls back to matched.length when company_open_count is absent", () => {
    const stats = deriveCompanyStats([job({}), job({})], NOW);
    assert.equal(stats.totalOpenRoles, 2);
  });

  it("prefers the ingest-side company_open_count aggregate when present", () => {
    const stats = deriveCompanyStats([job({ company_open_count: 47 }), job({ company_open_count: 47 })], NOW);
    assert.equal(stats.totalOpenRoles, 47);
  });

  it("tallies ghost mix across every badge, including badges absent from the hit set", () => {
    const stats = deriveCompanyStats(
      [job({ ghost_badge: "clear" }), job({ ghost_badge: "clear" }), job({ ghost_badge: "likely_ghost" })],
      NOW,
    );
    const byBadge = Object.fromEntries(stats.ghostMix.map((r) => [r.badge, r.count]));
    assert.equal(byBadge.clear, 2);
    assert.equal(byBadge.likely_ghost, 1);
    assert.equal(byBadge.caution, 0);
    assert.equal(byBadge.unscored, 0);
  });

  it("null posted_ts is excluded from freshness buckets rather than miscounted", () => {
    const stats = deriveCompanyStats(
      [job({ posted_ts: null }), job({ posted_ts: NOW - 2 * DAY_MS })],
      NOW,
    );
    const total = stats.freshness.reduce((sum, r) => sum + r.count, 0);
    assert.equal(total, 1);
    const byBucket = Object.fromEntries(stats.freshness.map((r) => [r.bucket, r.count]));
    assert.equal(byBucket["7d"], 1);
  });

  it("buckets postings across the full age spread, agreeing with classifyPostingAgeBucket's edges", () => {
    const stats = deriveCompanyStats(
      [
        job({ posted_ts: NOW - 1 * DAY_MS }), // 7d
        job({ posted_ts: NOW - 20 * DAY_MS }), // 30d
        job({ posted_ts: NOW - 45 * DAY_MS }), // 60d
        job({ posted_ts: NOW - 90 * DAY_MS }), // older
      ],
      NOW,
    );
    const byBucket = Object.fromEntries(stats.freshness.map((r) => [r.bucket, r.count]));
    assert.equal(byBucket["7d"], 1);
    assert.equal(byBucket["30d"], 1);
    assert.equal(byBucket["60d"], 1);
    assert.equal(byBucket.older, 1);
  });
});

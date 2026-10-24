import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveCompanyStats, dominantCompanyDomain, resolveProfileName } from "../../src/lib/companies/company-stats";
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

// Company-name seam rework (2026-08-29): the index carries the ATS-stated
// raw name (intervu owns display-time cleaning, not ingest — a separate
// repo writes the live index and PUTs the feed through unchanged), so
// `/companies/[slug]`'s <h1> used to render the raw corpus string.
// Cleaner-algorithm coverage lives in jobs-company-clean.test.ts — these
// prove this chokepoint actually calls it, and the fallback path when
// cleaning empties out.
describe("resolveProfileName", () => {
  it("cleans the first matched hit's raw company name", () => {
    const name = resolveProfileName([job({ company: "REQ123 Acme Co" })], "acme co", "acme.com");
    assert.equal(name, "Acme Co");
  });

  it("falls back to the trimmed input company when there are no matched hits", () => {
    const name = resolveProfileName([], "  Acme Co  ", null);
    assert.equal(name, "Acme Co");
  });

  it("falls back to the trimmed input company when cleaning the matched hit yields nothing", () => {
    const name = resolveProfileName([job({ company: "" })], "Acme Co", null);
    assert.equal(name, "Acme Co");
  });
});

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

  it("finds company_open_count on a later hit — the sync stamps it document by document", () => {
    const stats = deriveCompanyStats([job({}), job({}), job({ company_open_count: 47 })], NOW);
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

describe("dominantCompanyDomain", () => {
  it("picks the most frequent non-empty domain among mixed values", () => {
    const domain = dominantCompanyDomain([
      job({ company_domain: "acme.com" }),
      job({ company_domain: "acme.com" }),
      job({ company_domain: "other.com" }),
    ]);
    assert.equal(domain, "acme.com");
  });

  it("returns null when every hit's domain is empty", () => {
    const domain = dominantCompanyDomain([
      job({ company_domain: null }),
      job({ company_domain: "" }),
      job({ company_domain: "   " }),
    ]);
    assert.equal(domain, null);
  });

  it("never picks an ATS or vendor host, even with the most rows", () => {
    const rows = (d: string, n: number) => Array.from({ length: n }, () => job({ company_domain: d }));
    assert.equal(dominantCompanyDomain([...rows("jobs.lever.co", 5), ...rows("acme.com", 1)]), "acme.com");
    assert.equal(dominantCompanyDomain(rows("acme.wd5.workday.com", 3)), null);
  });

  it("returns the domain from a single hit", () => {
    const domain = dominantCompanyDomain([job({ company_domain: "solo.io" })]);
    assert.equal(domain, "solo.io");
  });

  it("normalizes casing/whitespace the same way domainToSlug does before tallying", () => {
    const domain = dominantCompanyDomain([
      job({ company_domain: "Acme.com" }),
      job({ company_domain: " acme.com " }),
      job({ company_domain: "OTHER.com" }),
    ]);
    assert.equal(domain, "acme.com");
  });
});

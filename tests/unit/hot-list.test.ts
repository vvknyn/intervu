import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateHotCompaniesFromJobs,
  rankHotCompanies,
  type HotCompanyRow,
} from "@/lib/companies/hot-list";
import type { PublicJob } from "@/lib/jobs/types";

const row = (overrides: Partial<HotCompanyRow>): HotCompanyRow => ({
  domain: "example.com",
  slug: "example-com",
  name: "Example",
  oneLiner: null,
  opened90d: null,
  openCount: 0,
  ...overrides,
});

describe("rankHotCompanies", () => {
  it("sorts by opened90d descending among rows with observations", () => {
    const ranked = rankHotCompanies([
      row({ domain: "a.com", opened90d: 5 }),
      row({ domain: "b.com", opened90d: 22 }),
      row({ domain: "c.com", opened90d: 18 }),
    ]);
    assert.deepEqual(
      ranked.map((r) => r.domain),
      ["b.com", "c.com", "a.com"],
    );
  });

  it("excludes rows without opened90d observations", () => {
    const ranked = rankHotCompanies([
      row({ domain: "a.com", opened90d: 12 }),
      row({ domain: "b.com", opened90d: null, openCount: 40 }),
    ]);
    assert.equal(ranked.length, 1);
    assert.equal(ranked[0]?.domain, "a.com");
  });

  it("does not mutate the input array", () => {
    const input = [row({ domain: "a.com", opened90d: 3 }), row({ domain: "b.com", opened90d: 9 })];
    const copy = [...input];
    rankHotCompanies(input);
    assert.deepEqual(input, copy);
  });
});

describe("aggregateHotCompaniesFromJobs", () => {
  it("groups elite jobs by domain and prefers denormalized counts", () => {
    const jobs = [
      {
        id: "1",
        company_domain: "rad-ai.com",
        company: "Rad AI",
        company_stage: "AI radiology",
        company_opened_90d: 22,
        company_open_count: 31,
      },
      {
        id: "2",
        company_domain: "rad-ai.com",
        company: "Rad AI",
        company_opened_90d: 22,
        company_open_count: 31,
      },
      {
        id: "3",
        company_domain: "horizon3.ai",
        company: "Horizon3",
        company_opened_90d: 18,
        company_open_count: 24,
      },
    ] as PublicJob[];

    const rows = aggregateHotCompaniesFromJobs(jobs);
    assert.equal(rows.length, 2);
    const rad = rows.find((r) => r.domain === "rad-ai.com");
    assert.equal(rad?.opened90d, 22);
    assert.equal(rad?.openCount, 31);
    assert.equal(rad?.slug, "rad-ai--com");
  });

  it("falls back to job count when open_count is missing", () => {
    const jobs = [
      { id: "1", company_domain: "console.dev", company: "Console" },
      { id: "2", company_domain: "console.dev", company: "Console" },
    ] as PublicJob[];

    const rows = aggregateHotCompaniesFromJobs(jobs);
    assert.equal(rows[0]?.openCount, 2);
    assert.equal(rows[0]?.opened90d, null);
  });
});

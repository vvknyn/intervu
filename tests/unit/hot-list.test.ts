import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateHotCompaniesFromJobs,
  ELITE_JOBS_MAX_HITS,
  ELITE_JOBS_PAGE_SIZE,
  fetchEliteBoardJobHits,
  getHotCompaniesList,
  rankHotCompanies,
  type HotCompanyRow,
} from "@/lib/companies/hot-list";
import { SEARCH_UNAVAILABLE_MESSAGE } from "@/lib/jobs/result-state";
import type { JobSearchParams, JobSearchResult, PublicJob } from "@/lib/jobs/types";

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

  it("reads the aggregates off whichever of the domain's jobs carries them, not job 0", () => {
    // The sync stamps `company_*` document by document, so a company's leading
    // job can carry nothing while a sibling already does. Reading job 0 dropped
    // the company off this list entirely — `rankHotCompanies` excludes rows
    // without `opened90d`.
    const jobs = [
      { id: "1", company_domain: "akamai.com", company: "Akamai" },
      { id: "2", company_domain: "akamai.com", company: "Akamai" },
      {
        id: "3",
        company_domain: "akamai.com",
        company: "Akamai",
        company_opened_90d: 224,
        company_open_count: 203,
      },
    ] as PublicJob[];

    const rows = aggregateHotCompaniesFromJobs(jobs);
    assert.equal(rows[0]?.opened90d, 224);
    assert.equal(rows[0]?.openCount, 203);
    assert.equal(rankHotCompanies(rows).length, 1);
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

function searchResult(hits: PublicJob[], overrides: Partial<JobSearchResult> = {}): JobSearchResult {
  return {
    hits,
    total: hits.length,
    backend: "meilisearch",
    configured: true,
    ...overrides,
  };
}

function job(id: string, domain: string): PublicJob {
  return { id, company_domain: domain, company: domain.split(".")[0] } as PublicJob;
}

describe("fetchEliteBoardJobHits", () => {
  it("paginates until a short page", async () => {
    const pageSize = ELITE_JOBS_PAGE_SIZE;
    const pages = [
      Array.from({ length: pageSize }, (_, i) => job(`p0-${i}`, "a.com")),
      [job("p1-0", "b.com")],
    ];
    let call = 0;

    const fetched = await fetchEliteBoardJobHits(async (p: JobSearchParams) => {
      assert.equal(p.board, "elite");
      assert.equal(p.offset, call === 0 ? 0 : pageSize);
      return searchResult(pages[call++] ?? []);
    });

    assert.equal("unavailable" in fetched, false);
    if ("unavailable" in fetched) return;
    assert.equal(fetched.hits.length, pageSize + 1);
  });

  it("returns unavailable when search fails", async () => {
    const fetched = await fetchEliteBoardJobHits(async () =>
      searchResult([], { unavailable: true, note: SEARCH_UNAVAILABLE_MESSAGE }),
    );

    assert.equal("unavailable" in fetched, true);
    if (!("unavailable" in fetched)) return;
    assert.equal(fetched.message, SEARCH_UNAVAILABLE_MESSAGE);
  });

  it("stops at ELITE_JOBS_MAX_HITS", async () => {
    let offset = 0;
    const fetched = await fetchEliteBoardJobHits(async (p: JobSearchParams) => {
      offset = p.offset ?? 0;
      const limit = p.limit ?? ELITE_JOBS_PAGE_SIZE;
      return searchResult(Array.from({ length: limit }, (_, i) => job(`${offset}-${i}`, "a.com")));
    });

    assert.equal("unavailable" in fetched, false);
    if ("unavailable" in fetched) return;
    assert.equal(fetched.hits.length, ELITE_JOBS_MAX_HITS);
    assert.equal(offset, ELITE_JOBS_MAX_HITS - ELITE_JOBS_PAGE_SIZE);
  });
});

describe("getHotCompaniesList", () => {
  it("surfaces unavailable instead of an empty ok result", async () => {
    const result = await getHotCompaniesList(async () =>
      searchResult([], { unavailable: true, note: SEARCH_UNAVAILABLE_MESSAGE }),
    );
    assert.deepEqual(result, { status: "unavailable", message: SEARCH_UNAVAILABLE_MESSAGE });
  });
});

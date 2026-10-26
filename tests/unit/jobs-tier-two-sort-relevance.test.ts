/**
 * Vivek 2026-10-26: every word, every sort. A typed search matches only documents containing every typed word,
 * under relevance too (supersedes the partial-match tier of #944). Tier 2 of a bare role query's tiered retrieval
 * (`buildTieredQuerySpecs`, meilisearch.ts) widens the fields searched, never the words dropped, so a sort only
 * re-orders one set. The tests pin the BUILT request, not the hits.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTieredQuerySpecs } from "../../src/lib/jobs/meilisearch";
import { resumeContentMark, searchParamsFromUrlState } from "../../src/lib/jobs/search-payload";
import { DEFAULT_URL_STATE } from "../../src/lib/jobs/url-state";
import type { JobSearchParams } from "../../src/lib/jobs/types";

const strategies = (p: JobSearchParams) => buildTieredQuerySpecs(p).map((s) => s.query.matchingStrategy);

describe("tier 2 requires every word under every sort", () => {
  const cases: [string, JobSearchParams, string[] | undefined][] = [
    ["speech therapist + Freshest", { q: "speech therapist", sort: "newest" }, ["posted_ts:desc"]],
    ["data engineer + Freshest", { q: "data engineer", sort: "newest" }, ["posted_ts:desc"]],
    ["nurse (one word) + Freshest", { q: "nurse", sort: "newest" }, ["posted_ts:desc"]],
    ["senior speech therapist (3 words) + Freshest", { q: "senior speech therapist", sort: "newest" }, ["posted_ts:desc"]],
    ["speech therapist + relevance", { q: "speech therapist", sort: "relevance" }, undefined],
    ["speech therapist + no sort", { q: "speech therapist" }, undefined],
    ["speech therapist + salary", { q: "speech therapist", sort: "salary_desc" }, ["salary_max:desc", "salary_min:desc"]],
  ];
  for (const [label, p, sort] of cases) {
    it(`${label}: every word required in both tiers, same q and filter, sort passed through`, () => {
      const [t1, t2] = buildTieredQuerySpecs(p);
      assert.deepEqual(strategies(p), ["all", "all"]);
      assert.equal(t1.query.q, t2.query.q);
      assert.ok(t1.query.q.replaceAll('"', "") === p.q, "q is the typed query (short tokens quoted)");
      assert.deepEqual(t1.query.filter, t2.query.filter, "tiers differ only in scope");
      assert.deepEqual([t1.query.sort, t2.query.sort], [sort, sort]);
    });
  }

  it("the unknown-inclusive pair follows the same rule, relevance included", () => {
    assert.deepEqual(strategies({ q: "data engineer", salaryMin: 100_000 }), ["all", "all", "all", "all"]);
    const p: JobSearchParams = { q: "data engineer", sort: "newest", salaryMin: 100_000 };
    assert.deepEqual(strategies(p), ["all", "all", "all", "all"]);
  });
});

describe("résumé terms rank, never widen, a typed search", () => {
  const pack = { q: '"Product Manager" OR "Program Manager"', phrases: ["Product Manager", "Program Manager"] };

  it("a typed query beside the résumé's chip carries no résumé phrases, and Freshest builds the typed request alone", () => {
    assert.deepEqual(resumeContentMark(true, "speech therapist", pack), {});
    const p = searchParamsFromUrlState({ ...DEFAULT_URL_STATE, q: "speech therapist", sort: "newest", facets: { work_type: ["remote"] } });
    const [t1, t2] = buildTieredQuerySpecs({ ...p, ...resumeContentMark(true, "speech therapist", pack) });
    assert.equal(t1.query.q, "speech therapist");
    assert.equal(t2.query.q, "speech therapist");
    assert.ok(!/Product Manager/.test(JSON.stringify([t1.query, t2.query])));
    assert.equal(t2.query.matchingStrategy, "all");
    assert.ok(t2.query.filter.join().includes("work_type"), "filters stay on tier 2");
  });
});

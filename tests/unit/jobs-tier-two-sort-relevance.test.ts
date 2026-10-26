/**
 * 2026-10-26: "speech therapist" + Sort: Freshest listed a wedding video editor first. Tier 2 of a bare role
 * query's tiered retrieval (`buildTieredQuerySpecs`, meilisearch.ts) was `matchingStrategy: "last"` under every
 * sort: it drops trailing words, so the pool admitted every posting that merely mentions "speech", and with no
 * full match left in the filtered window a date sort put those one-word matches on top. An explicit sort now
 * requires every word in tier 2 (the pool is the relevant set, the sort only re-orders it); relevance keeps the
 * ranked-partials ruling. The tests pin the BUILT request, not the hits.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTieredQuerySpecs, tierTwoMatchingStrategy } from "../../src/lib/jobs/meilisearch";
import { resumeContentMark, searchParamsFromUrlState } from "../../src/lib/jobs/search-payload";
import { DEFAULT_URL_STATE } from "../../src/lib/jobs/url-state";
import type { JobSearchParams } from "../../src/lib/jobs/types";

const strategies = (p: JobSearchParams) => buildTieredQuerySpecs(p).map((s) => s.query.matchingStrategy);

describe("tier 2 matching strategy follows the sort", () => {
  const cases: [string, JobSearchParams, string[] | undefined][] = [
    ["speech therapist + Freshest", { q: "speech therapist", sort: "newest" }, ["posted_ts:desc"]],
    ["data engineer + Freshest", { q: "data engineer", sort: "newest" }, ["posted_ts:desc"]],
    ["nurse (one word) + Freshest", { q: "nurse", sort: "newest" }, ["posted_ts:desc"]],
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

  it("relevance (and no sort) keeps ranked partials: tier 2 drops trailing words", () => {
    assert.deepEqual(strategies({ q: "speech therapist" }), ["all", "last"]);
    assert.deepEqual(strategies({ q: "data engineer", sort: "relevance" }), ["all", "last"]);
    assert.equal(tierTwoMatchingStrategy({ q: "nurse" }), "last");
  });

  it("the unknown-inclusive pair follows the same rule", () => {
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

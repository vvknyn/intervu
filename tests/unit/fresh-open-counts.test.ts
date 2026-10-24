import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchOpenCounts } from "@/lib/companies/listed-names";
import { fetchRelatedCompanies, withFreshCounts } from "@/lib/companies/related-companies";
import { openCountLabel } from "@/lib/companies/presentation";
import { COMPANY_JOBS_FETCH_LIMIT } from "@/lib/companies/company-roles-query";
import type { DirectoryCompany } from "@/lib/companies/directory-model";
import type { CompanyFacts } from "@/lib/companies/company-facts";
import type { EachResult } from "@/lib/jobs/meilisearch";

/** A listed company whose memo (build-time) number is `memo`. */
const co = (domain: string, memo: number): DirectoryCompany => ({ domain, openRoleCount: memo, computedAt: null, name: domain.split(".")[0]!, letter: "Z" });

/** A reader answering `n` distinct public roles per domain, fully enumerated. */
const exact = (n: Record<string, number>) => async (domains: readonly string[]): Promise<EachResult[]> =>
  domains.map((d) => ({ hits: Array.from({ length: n[d]! }, (_, i) => ({ id: `${d}-${i}`, title: `Engineer ${i}`, company_domain: d })) as never, total: n[d]!, facetDistribution: undefined }));

describe("fetchOpenCounts", () => {
  it("counts each domain as the company page does, not as the memo says", async () => {
    const counts = await fetchOpenCounts(["zenbotix.com", "quillarc.io"], exact({ "zenbotix.com": 126, "quillarc.io": 3 }));
    assert.equal(counts.get("zenbotix.com")?.value, 126);
    assert.equal(counts.get("quillarc.io")?.value, 3);
    assert.equal(openCountLabel(counts.get("zenbotix.com")!), "126");
  });
  it("renders a lower bound with the page's plus sign", async () => {
    const saturated = async (domains: readonly string[]): Promise<EachResult[]> =>
      domains.map(() => ({ hits: [], total: COMPANY_JOBS_FETCH_LIMIT + 500, facetDistribution: undefined, preview: true }) as EachResult);
    const count = (await fetchOpenCounts(["vastmesh.com"], saturated)).get("vastmesh.com")!;
    assert.equal(count.isLowerBound, true);
    assert.match(openCountLabel(count), /\+$/);
  });
  it("returns no counts when the read throws, and warns", async () => {
    const warn = console.warn;
    const lines: string[] = [];
    console.warn = (m: string) => void lines.push(m);
    try {
      const counts = await fetchOpenCounts(["zenbotix.com"], async () => { throw new Error("meili down"); });
      assert.equal(counts.size, 0);
      assert.match(lines[0]!, /meili down/);
    } finally {
      console.warn = warn;
    }
  });
});

describe("withFreshCounts", () => {
  it("orders by the fresh count and carries no memo number", () => {
    const counts = new Map([["a.com", { value: 5, isLowerBound: false }], ["b.com", { value: 90, isLowerBound: false }]]);
    const rows = withFreshCounts([co("a.com", 500), co("b.com", 10), co("c.com", 300)], counts);
    assert.deepEqual(rows.map((r) => r.domain), ["b.com", "a.com", "c.com"]);
    assert.equal(rows[2]!.openCount, null);
    assert.ok(rows.every((r) => !("openRoleCount" in r)));
  });
});

describe("fetchRelatedCompanies", () => {
  const facts = { identity: { domain: "self.com" }, mix: { skills: { buckets: [{ value: "Go" }] } } } as unknown as CompanyFacts;
  const search = async () => ({ hits: [{ company_domain: "zenbotix.com" }, { company_domain: "quillarc.io" }] }) as never;
  const set = async () => [co("zenbotix.com", 152), co("quillarc.io", 40)];
  it("shows the fresh count and orders by it, though the memo ranks the other way", async () => {
    const rows = await fetchRelatedCompanies(facts, search, set, (d) => fetchOpenCounts(d, exact({ "zenbotix.com": 126, "quillarc.io": 200 })));
    assert.deepEqual(rows.map((r) => [r.domain, r.openCount?.value]), [["quillarc.io", 200], ["zenbotix.com", 126]]);
  });
  it("keeps the companies but drops every number when the count read fails", async () => {
    const rows = await fetchRelatedCompanies(facts, search, set, async () => new Map());
    assert.deepEqual(rows.map((r) => [r.domain, r.openCount]), [["zenbotix.com", null], ["quillarc.io", null]]);
  });
});

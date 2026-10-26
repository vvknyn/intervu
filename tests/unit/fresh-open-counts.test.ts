import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchOpenCounts } from "@/lib/companies/listed-names";
import { fetchRelatedCompanies, relatedHeading, withFreshCounts } from "@/lib/companies/related-companies";
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
    const rows = (await fetchRelatedCompanies(facts, search, set, (d) => fetchOpenCounts(d, exact({ "zenbotix.com": 126, "quillarc.io": 200 }))))!.companies;
    assert.deepEqual(rows.map((r) => [r.domain, r.openCount?.value]), [["quillarc.io", 200], ["zenbotix.com", 126]]);
  });
  it("keeps the companies but drops every number when the count read fails", async () => {
    const rows = (await fetchRelatedCompanies(facts, search, set, async () => new Map()))!.companies;
    assert.deepEqual(rows.map((r) => [r.domain, r.openCount]), [["zenbotix.com", null], ["quillarc.io", null]]);
  });
  it("names the shared skill, whatever it is", async () => {
    const r = await fetchRelatedCompanies(facts, search, set, async () => new Map());
    assert.equal(relatedHeading(r!.facet), "Also hiring for Go");
  });
  it("names the shared country when there is no skill", async () => {
    const uk = { identity: { domain: "self.com" }, mix: { countries: { buckets: [{ value: "United Kingdom" }] } } } as unknown as CompanyFacts;
    const r = await fetchRelatedCompanies(uk, search, set, async () => new Map());
    assert.equal(relatedHeading(r!.facet), "Also hiring in United Kingdom");
  });
  const facetOf = (mix: object) => fetchRelatedCompanies({ identity: { domain: "self.com" }, mix } as unknown as CompanyFacts, search, set, async () => new Map()).then((r) => r!.facet);
  it("uses the top tech, with a 'for' heading, when no skill is stamped", async () => {
    const f = await facetOf({ skills: null, tech: { buckets: [{ value: "Rust" }] }, countries: { buckets: [{ value: "Germany" }] } });
    assert.deepEqual(f, { key: "tech_stack", value: "Rust" });
    assert.equal(relatedHeading(f), "Also hiring for Rust");
  });
  it("prefers a stamped skill over tech", async () => {
    const f = await facetOf({ skills: { buckets: [{ value: "SQL" }] }, tech: { buckets: [{ value: "Rust" }] } });
    assert.deepEqual(f, { key: "must_have_skills", value: "SQL" });
  });
  it("uses the country, with an 'in' heading, when neither skill nor tech exists", async () => {
    const f = await facetOf({ skills: null, tech: null, countries: { buckets: [{ value: "Germany" }] } });
    assert.deepEqual(f, { key: "location_country", value: "Germany" });
    assert.equal(relatedHeading(f), "Also hiring in Germany");
  });
  describe("industry rung", () => {
    const wd = (...industries: string[]) => ({ wikidataIndustries: [{ label: "x", industries }] });
    const dir = [
      { ...co("self.com", 10), ...wd("logistics", "Freight") },
      { ...co("haul.io", 5), ...wd("freight") },
      { ...co("shipall.com", 3), ...wd("Logistics", "freight") },
      { ...co("bakery.com", 99), ...wd("food") },
      { ...co("plain.com", 50) },
    ];
    const noSearch = async () => { throw new Error("industry rung must not search"); };
    const run = (f: CompanyFacts, d = dir) => fetchRelatedCompanies(f, noSearch, async () => d, async () => new Map());
    const mixOnly = (domain: string, countries?: string) => ({ identity: { domain }, mix: countries ? { countries: { buckets: [{ value: countries }] } } : {} }) as unknown as CompanyFacts;
    it("lists companies sharing an industry, most shared first, with no search, when there is no skill or tech", async () => {
      const r = await run(mixOnly("self.com", "Germany"));
      assert.deepEqual(r!.companies.map((c) => c.domain), ["shipall.com", "haul.io"]);
      assert.equal(relatedHeading(r!.facet), "Other Logistics companies hiring");
    });
    it("gives two same-country companies different lists", async () => {
      const d = [...dir, { ...co("oven.com", 1), ...wd("Food") }];
      const a = await run(mixOnly("self.com", "Germany"), d);
      const b = await run(mixOnly("bakery.com", "Germany"), d);
      assert.deepEqual(b!.companies.map((c) => c.domain), ["oven.com"]);
      assert.notDeepEqual(a!.companies.map((c) => c.domain), b!.companies.map((c) => c.domain));
    });
    it("falls to the country when the company has no industries", async () => {
      const r = await fetchRelatedCompanies(mixOnly("plain.com", "Germany"), search, set, async () => new Map());
      assert.deepEqual(r!.facet, { key: "location_country", value: "Germany" });
    });
  });
  it("is null with no facet, a thrown search, or no match", async () => {
    const none = { identity: { domain: "self.com" }, mix: {} } as unknown as CompanyFacts;
    assert.equal(await fetchRelatedCompanies(none, search, set), null);
    const err = console.error;
    console.error = () => {};
    try {
      assert.equal(await fetchRelatedCompanies(facts, async () => { throw new Error("down"); }, set), null);
    } finally {
      console.error = err;
    }
    assert.equal(await fetchRelatedCompanies(facts, async () => ({ hits: [] }) as never, set), null);
  });
});

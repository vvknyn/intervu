import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCountGeneration, createCountGeneration, type CountGeneration, type FlightStore } from "@/lib/companies/directory-model";
import { fetchRelatedCompanies } from "@/lib/companies/related-companies";
import { getCompanyPageData } from "@/lib/companies/get-company";
import type { CompanyFacts } from "@/lib/companies/company-facts";
import type { OpenCount } from "@/lib/companies/open-count";
import type { EachResult } from "@/lib/jobs/meilisearch";
import type { PublicJob } from "@/lib/jobs/types";

const count = (value: number): OpenCount => ({ value, isLowerBound: false });
const DOMAIN = "zenbotix.com";
const OTHER = "quillarc.io";

/** `n` distinct public roles for `domain`, fully enumerated. */
const rows = (domain: string, n: number): PublicJob[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${domain}-${i}`, title: `Engineer ${i}`, company: "Zenbotix", company_domain: domain, location_city: `City ${i}` }) as PublicJob);

describe("one count generation", () => {
  it("gives a listed domain the same number on the letter, related and company paths though its fresh read differs", async () => {
    const generation: CountGeneration = new Map([[DOMAIN, count(41)]]);
    const g = createCountGeneration(async () => generation, { value: generation, builtAt: Date.now() });
    const fresh7 = async (d: readonly string[]) => new Map(d.map((x) => [x, count(7)]));
    assert.equal((await g.resolve([DOMAIN], fresh7)).get(DOMAIN)?.value, 41);
    const page = await getCompanyPageData(DOMAIN.replace(".", "--"), async () => ({ hits: rows(DOMAIN, 7), total: 7 }) as never, { countGeneration: g.peek, directory: async () => ({ companies: [] }) });
    assert.equal(page?.openCount, 41);
    const facts = { identity: { domain: "self.com" }, mix: { skills: { buckets: [{ value: "Go" }] } } } as unknown as CompanyFacts;
    const listed = [{ domain: DOMAIN, openRoleCount: 1, computedAt: null, name: "Zenbotix", letter: "Z" }];
    const related = await fetchRelatedCompanies(facts, async () => ({ hits: [{ company_domain: DOMAIN }] }) as never, async () => listed, (d) => g.resolve(d, fresh7));
    assert.equal(related[0]?.openCount?.value, 41);
  });

  it("reads an unlisted domain fresh, beside a listed one served from the generation", async () => {
    const g = createCountGeneration(async () => new Map(), { value: new Map([[DOMAIN, count(41)]]), builtAt: Date.now() });
    const asked: string[][] = [];
    const counts = await g.resolve([DOMAIN, OTHER], async (d) => (asked.push([...d]), new Map(d.map((x) => [x, count(3)]))));
    assert.equal(counts.get(DOMAIN)?.value, 41);
    assert.equal(counts.get(OTHER)?.value, 3);
    assert.deepEqual(asked, [[OTHER]]);
    const page = await getCompanyPageData(`${OTHER.replace(".", "--")}`, async () => ({ hits: rows(OTHER, 3), total: 3 }) as never, { countGeneration: g.peek, directory: async () => ({ companies: [] }) });
    assert.equal(page?.openCount, 3);
  });

  it("keeps the previous generation when a rebuild fails", async () => {
    const store: FlightStore<CountGeneration> = { value: new Map([[DOMAIN, count(41)]]), builtAt: 0 };
    const warn = console.warn;
    console.warn = () => {};
    try {
      const g = createCountGeneration(async () => { throw new Error("meili down"); }, store);
      g.peek(); // stale: starts the refresh
      await new Promise((r) => setTimeout(r, 0));
      assert.equal(g.peek()?.get(DOMAIN)?.value, 41);
    } finally {
      console.warn = warn;
    }
  });

  it("a build that cannot read throws instead of yielding a partial map", async () => {
    await assert.rejects(() => buildCountGeneration(async () => ({ companies: [{ domain: DOMAIN }] }) as never, async () => { throw new Error("meili down"); }), /meili down/);
  });

  it("builds from the listed domains with the page's count function", async () => {
    const read = async (d: readonly string[]): Promise<EachResult[]> => d.map((x, i) => ({ hits: rows(x, i + 2), total: i + 2 }) as never);
    const built = await buildCountGeneration(async () => ({ companies: [{ domain: DOMAIN }, { domain: OTHER }] }) as never, read);
    assert.equal(built.get(DOMAIN)?.value, 2);
    assert.equal(built.get(OTHER)?.value, 3);
  });

  it("on a cold start serves fresh reads and starts the build without waiting for it", async () => {
    let builds = 0;
    const g = createCountGeneration(() => (builds++, new Promise<CountGeneration>(() => {})), {});
    const counts = await g.resolve([DOMAIN], async (d) => new Map(d.map((x) => [x, count(9)])));
    assert.equal(counts.get(DOMAIN)?.value, 9);
    assert.equal(builds, 1);
  });
});

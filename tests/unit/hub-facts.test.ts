import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HubSections } from "@/components/seo/HubSections";
import { CAREER_HUBS } from "@/lib/seo/career-hubs";
import { HUB_ROLE_LIMIT, loadHubFacts, type HubFacts } from "@/lib/seo/hub-facts";
import type { JobSearchResult, PublicJob } from "@/lib/jobs/types";

const hub = CAREER_HUBS[0];
const job = (i: number): PublicJob =>
  ({ id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`, title: `Role ${i}`, company: "Acme", company_domain: i % 2 ? "acme.com" : "beta.io", location: "Remote", posted_ts: Date.now() - i * 3600_000 }) as PublicJob;
const result = (n: number, total = 1234): JobSearchResult => ({ hits: Array.from({ length: n }, (_, i) => job(i)), total, backend: "meilisearch", configured: true });
const deps = (search: () => Promise<JobSearchResult>) => ({
  search,
  indexable: async () => [{ domain: "acme.com", openRoleCount: 30, computedAt: null, name: "Acme Systems", letter: "A" }, { domain: "beta.io", openRoleCount: 40, computedAt: null, name: "Beta", letter: "B" }],
});
const render = (facts: HubFacts) => renderToStaticMarkup(createElement(HubSections, { facts, label: hub.label, now: Date.now() }));
const anchors = (html: string) => html.match(/<a [^>]*href="\/jobs\//g)?.length ?? 0;

describe("career hub facts", () => {
  for (const hits of [3, 50, 120]) {
    it(`renders min(${HUB_ROLE_LIMIT}, hits) role anchors for ${hits} hits, the labelled total and company names`, async () => {
      const facts = await loadHubFacts(hub, deps(async () => result(hits)));
      const html = render(facts);
      assert.equal(anchors(html), Math.min(HUB_ROLE_LIMIT, hits));
      assert.match(html, /1,234<\/span> live matching roles/);
      assert.match(html, /Acme Systems/);
    });
  }
  it("omits every section when the search fails or is unavailable", async () => {
    for (const search of [async () => { throw new Error("boom"); }, async () => ({ ...result(10), unavailable: true })]) {
      const html = render(await loadHubFacts(hub, deps(search)));
      assert.equal(html, "");
    }
  });
  it("keeps the count and roles when only the company set fails", async () => {
    const facts = await loadHubFacts(hub, { ...deps(async () => result(5)), indexable: async () => { throw new Error("no directory"); } });
    assert.equal(facts.roles.length, 5);
    assert.equal(facts.companies.length, 0);
  });
});

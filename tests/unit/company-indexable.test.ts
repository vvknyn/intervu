import assert from "node:assert/strict";
import { siteSpelling } from "@/lib/companies/company-name";
import { describe, it } from "node:test";
import {
  DIRECTORY_POOL_SIZE,
  MIN_SITEMAP_ROLES,
  fetchIndexableCompanyDomains,
  parseCompanyDirectoryHit,
  resolveCompanyIndexability,
} from "@/lib/companies/indexable";
import { buildCompanyFacts, type CompanyFacts } from "@/lib/companies/company-facts";
import {
  buildCompanyPageMetadata,
  companyMetaDescription,
  openCountText,
  sampleCoversAllRoles,
} from "@/lib/companies/presentation";
import type { CompanyPageData } from "@/lib/companies/types";
import type { PublicJob } from "@/lib/jobs/types";

process.env.NEXT_PUBLIC_SITE_URL = "https://intervuhq.com";
// `fetchIndexableCompanyDomains` only checks that a host is configured;
// every test below injects its own fake `search`, so no real network call is
// ever made against this value.
process.env.MEILISEARCH_HOST = "https://meili.test";

/** N placeholder roles. The gate reads only `jobs.length`; nothing here
 *  depends on a role's contents, so they stay deliberately empty. */
function roles(n: number): PublicJob[] {
  return Array.from({ length: n }, (_, i) => ({ id: `job-${i}` })) as unknown as PublicJob[];
}

/** Facts for a company whose box/facet data is as given: a stated country and
 *  a posting date by default, each removable to prove the rule needs it. */
function factsFor(
  openCount: number,
  { country = true, posted = true }: { country?: boolean; posted?: boolean } = {},
): CompanyFacts {
  const jobs = openCount > 0 && posted ? [{ id: "j", posted_at: "2026-10-01T00:00:00Z" } as unknown as PublicJob] : [];
  return buildCompanyFacts({
    name: "Acme",
    domain: "acme.com",
    jobs,
    openCount: { value: openCount, isLowerBound: false },
    postingTotal: openCount,
    facetDistribution: country ? { location_country: { "United States": openCount } } : undefined,
  });
}

function company(overrides: Partial<CompanyPageData> = {}): CompanyPageData {
  const jobs = overrides.jobs ?? roles(5);
  return {
    domain: "acme.com",
    slug: "acme--com",
    name: "Acme",
    nameSource: "corpus-cased",
    changeEvents: [],
    oneLiner: null,
    stage: null,
    openCount: jobs.length,
    openCountIsLowerBound: false,
    ghostFlaggedPct: null,
    boards: ["elite"],
    nowMs: Date.now(),
    exhaust: null,
    facts: factsFor(jobs.length),
    ...overrides,
    jobs,
  };
}

/** Records every `company_directory` search request sent, and replies with
 *  one fixed page per call (or `{ hits: [] }` past the end of `pages`) — so a
 *  test can assert on the exact request shape without a network call. Shared
 *  by the sitemap paging walk and the single-doc snapshot lookup, which both
 *  call through the same `searchCompanyDirectoryPage` shape. */
function fakeSearch(pages: Record<string, unknown>[][], total?: number) {
  const calls: { sort: string[]; filter: string; limit: number; offset: number }[] = [];
  let round = 0;
  const search = async (request: { sort: string[]; filter: string; limit: number; offset: number }) => {
    calls.push(request);
    const hits = pages[round] ?? [];
    round += 1;
    return { hits, total: total ?? pages.reduce((n, page) => n + page.length, 0) };
  };
  return { calls, search };
}

describe("resolveCompanyIndexability — one rule: indexable ⇔ in the sitemap set", () => {
  it("is indexable and in the sitemap together for a set member", () => {
    assert.deepEqual(resolveCompanyIndexability({ inSitemapSet: true }), { inSitemap: true, pageIndexable: true });
  });

  it("is neither outside the sitemap set (below MIN_SITEMAP_ROLES or past the cap)", () => {
    assert.deepEqual(resolveCompanyIndexability({ inSitemapSet: false }), { inSitemap: false, pageIndexable: false });
  });

  it("a set member lacking any stated country is still indexable", async () => {
    const noCountry = factsFor(40, { country: false });
    assert.equal(noCountry.mix.countries, null);
    const meta = await buildCompanyPageMetadata(company({ jobs: roles(40), facts: noCountry }), async () => true);
    assert.equal(meta.robots, undefined);
  });

  it("a set member with no posting date is still indexable", async () => {
    const meta = await buildCompanyPageMetadata(company({ jobs: roles(40), facts: factsFor(40, { posted: false }) }), async () => true);
    assert.equal(meta.robots, undefined);
  });

  it("a company outside the listed set is noindex,follow, with the same canonical", async () => {
    const meta = await buildCompanyPageMetadata(company({ jobs: roles(40), facts: factsFor(40) }), async () => false);
    assert.deepEqual(meta.robots, { index: false, follow: true });
    assert.equal(meta.alternates?.canonical, "/co/acme--com");
  });

  it("keeps inSitemap and pageIndexable equal, so the sitemap never lists a noindex page", () => {
    for (const inSitemapSet of [true, false]) {
      const r = resolveCompanyIndexability({ inSitemapSet });
      assert.equal(r.inSitemap, r.pageIndexable);
    }
  });
});

describe("/co/[slug] metadata", () => {
  /** Stubs the sitemap-set lookup so these tests exercise only
   *  `buildCompanyPageMetadata`'s own logic, never the network. */
  const inSet = (member: boolean) => async () => member;

  it("emits a self-referencing canonical on an indexable page", async () => {
    const meta = await buildCompanyPageMetadata(company({ jobs: roles(40), facts: factsFor(40) }), inSet(true));
    assert.equal(meta.alternates?.canonical, "/co/acme--com");
    assert.equal(meta.robots, undefined);
  });

  it("emits the SAME canonical on a noindex page, with follow retained", async () => {
    // A de-indexed page still has to declare which URL it is — that is what
    // consolidates the intervu.cc -> intervuhq.com and /companies/[slug]
    // redirect paths onto one address.
    const meta = await buildCompanyPageMetadata(company({ jobs: roles(0), openCount: 0, facts: factsFor(0) }), inSet(false));
    assert.equal(meta.alternates?.canonical, "/co/acme--com");
    assert.deepEqual(meta.robots, { index: false, follow: true });
  });

  it("builds the canonical from the domain, so it matches the sitemap's URL", async () => {
    const meta = await buildCompanyPageMetadata(company({ domain: "1password.com", jobs: roles(59) }), inSet(true));
    assert.equal(meta.alternates?.canonical, "/co/1password--com");
  });

  it("a 10-role company (indexable under the old 3-role floor) is now noindex,follow", async () => {
    const meta = await buildCompanyPageMetadata(company({ jobs: roles(10), facts: factsFor(10) }), inSet(false));
    assert.deepEqual(meta.robots, { index: false, follow: true });
  });

  it("a track record no longer buys indexation: outside the set it is noindex,follow", async () => {
    const meta = await buildCompanyPageMetadata(
      company({ jobs: roles(0), openCount: 0, facts: factsFor(0) }),
      inSet(false),
    );
    assert.deepEqual(meta.robots, { index: false, follow: true });
  });
});

describe("/co/[slug] presentation — numbers the page can actually back", () => {
  it("renders a lower-bound open count as a floor, never as an exact number", () => {
    assert.equal(openCountText({ openCount: 200, openCountIsLowerBound: true }), "200+");
    assert.equal(openCountText({ openCount: 12, openCountIsLowerBound: false }), "12");
  });

  it("says 'at least' in the meta description when the count is a floor", () => {
    assert.match(
      companyMetaDescription(company({ openCount: 200, openCountIsLowerBound: true })),
      /has at least 200 live, verified open roles/,
    );
    assert.match(
      companyMetaDescription(company({ jobs: roles(12), openCount: 12 })),
      /has 12 live, verified open roles/,
    );
  });

  it("knows when the fetched sample covers only a window, not the whole employer", () => {
    assert.equal(
      sampleCoversAllRoles({ jobs: roles(200), openCount: 940, openCountIsLowerBound: false }),
      false,
    );
    assert.equal(
      sampleCoversAllRoles({ jobs: roles(12), openCount: 12, openCountIsLowerBound: false }),
      true,
    );
  });

  // The measured regression (2026-08-17, anthropic.com live on :3987): 469
  // open roles, an EXACT Meili total on the healthy page-mode path, of which
  // the page fetches 200. `openCountIsLowerBound` is correctly false here —
  // the count is provable — so a scope disclosure keyed off that flag stayed
  // silent on the employers whose window was least complete. The two
  // questions are separate: "is the COUNT exact?" vs "did we LOAD all of it?"
  it("an EXACT count larger than the window is still only a sample — isLowerBound is a different question", () => {
    assert.equal(
      sampleCoversAllRoles({ jobs: roles(200), openCount: 469, openCountIsLowerBound: false }),
      false,
    );
  });

  // The other direction, and a case the surfacing bug never exercised: the
  // window holds every role the count names, but the count is a FLOOR, so an
  // unknown number exist past it. `200 >= 200` must not be read as a census
  // over a number the page itself renders as "200+".
  it("a saturated window against a FLOOR count is not coverage, even at equality", () => {
    assert.equal(
      sampleCoversAllRoles({ jobs: roles(200), openCount: 200, openCountIsLowerBound: true }),
      false,
    );
    assert.equal(
      sampleCoversAllRoles({ jobs: roles(200), openCount: 200, openCountIsLowerBound: false }),
      true,
    );
  });
});

describe("parseCompanyDirectoryHit — one company_directory doc", () => {
  it("shapes a well-formed hit", () => {
    assert.deepEqual(
      parseCompanyDirectoryHit({
        domain: "acme.com",
        open_role_count: 40,
        computed_at: "2026-08-12T03:43:08.472Z",
      }),
      {
        domain: "acme.com",
        openRoleCount: 40,
        computedAt: "2026-08-12T03:43:08.472Z",
      },
    );
  });

  it("carries site_names strings in order, ignores non-string entries, and omits the field when absent or not an array", () => {
    const hit = { domain: "acme.com", open_role_count: 40 };
    assert.deepEqual(parseCompanyDirectoryHit({ ...hit, site_names: ["Acme Co", 7, null, "Acme"] })?.siteNames, ["Acme Co", "Acme"]);
    assert.equal(parseCompanyDirectoryHit({ ...hit, site_names: "Acme" })?.siteNames, undefined);
    assert.ok(!("siteNames" in parseCompanyDirectoryHit(hit)!));
  });

  it("keeps site_names in siteNames and puts wikidata_names then row_names, deduped, in labelSpellings; absent when empty", () => {
    const hit = { domain: "acme.com", open_role_count: 40 };
    const parsed = parseCompanyDirectoryHit({ ...hit, site_names: ["Acme", "Acme Co"], wikidata_names: ["Acme Corp", "Acme"], row_names: ["Acme Corp", "Acme Corporation", 3] });
    assert.deepEqual(parsed?.siteNames, ["Acme", "Acme Co"]);
    assert.deepEqual(parsed?.labelSpellings, ["Acme Corp", "Acme", "Acme Corporation"]);
    const rowsOnly = parseCompanyDirectoryHit({ ...hit, row_names: ["Acme"] })!;
    assert.ok(!("siteNames" in rowsOnly));
    assert.deepEqual(rowsOnly.labelSpellings, ["Acme"]);
    assert.ok(!("labelSpellings" in parseCompanyDirectoryHit({ ...hit, wikidata_names: [] })!));
  });

  it("carries wikidata_industries items, dropping malformed entries; absent when none remain", () => {
    const hit = { domain: "acme.com", open_role_count: 40 };
    const parsed = parseCompanyDirectoryHit({ ...hit, wikidata_industries: [{ label: "Acme", industries: ["retail", 3] }, { label: "", industries: [] }, { label: "Bad" }, null] });
    assert.deepEqual(parsed?.wikidataIndustries, [{ label: "Acme", industries: ["retail"] }]);
    assert.ok(!("wikidataIndustries" in parseCompanyDirectoryHit({ ...hit, wikidata_industries: [] })!));
    assert.ok(!("wikidataIndustries" in parseCompanyDirectoryHit(hit)!));
  });

  it("siteNames is non-empty site_names only (any source); wikidata_names never become siteNames", () => {
    const hit = { domain: "acme.com", open_role_count: 40 };
    assert.deepEqual(parseCompanyDirectoryHit({ ...hit, site_names: ["Rocket Lab"], wikidata_names: ["Rocket Lab USA"] })?.siteNames, ["Rocket Lab"]);
    assert.deepEqual(parseCompanyDirectoryHit({ ...hit, site_names: ["HPE"], site_names_source: "wikidata" })?.siteNames, ["HPE"]);
    const igt = parseCompanyDirectoryHit({ domain: "igt.com", open_role_count: 40, site_names: [], wikidata_names: ["International Game Technology"], row_names: ["IGT"] })!;
    assert.ok(!("siteNames" in igt));
    assert.deepEqual(igt.labelSpellings, ["International Game Technology", "IGT"]);
    const pwc = parseCompanyDirectoryHit({ domain: "pwc.com", open_role_count: 40, wikidata_names: ["PricewaterhouseCoopers"] })!;
    assert.ok(!("siteNames" in pwc));
    assert.deepEqual(pwc.labelSpellings, ["PricewaterhouseCoopers"]);
  });

  it("an igt-shape hit lists as its own name, not the Wikidata expansion", () => {
    const igt = parseCompanyDirectoryHit({ domain: "igt.com", open_role_count: 40, site_names: [], wikidata_names: ["International Game Technology"], row_names: ["IGT"] })!;
    assert.equal(siteSpelling("IGT", igt.siteNames, igt.domain, undefined, igt.labelSpellings), "IGT");
  });

  it("a site_names entry still wins over a labelSpelling, through the parsed hit", () => {
    const parsed = parseCompanyDirectoryHit({ domain: "homedepot.com", open_role_count: 40, site_names: ["Home Depot"], wikidata_names: ["The HomeDepot"], row_names: ["HomeDepot"] })!;
    assert.equal(siteSpelling("Homedepot", parsed.siteNames, parsed.domain, undefined, parsed.labelSpellings), "Home Depot");
  });

  it("reads a missing computed_at as null rather than dropping the hit — computed_at is not a gate field", () => {
    const parsed = parseCompanyDirectoryHit({ domain: "acme.com", open_role_count: 40 });
    assert.ok(parsed);
    assert.equal(parsed.computedAt, null);
  });

  it("reads an unparseable computed_at as null", () => {
    const parsed = parseCompanyDirectoryHit({
      domain: "acme.com",
      open_role_count: 40,
      computed_at: "not-a-date",
    });
    assert.ok(parsed);
    assert.equal(parsed.computedAt, null);
  });

  it("rejects a hit missing domain", () => {
    assert.equal(parseCompanyDirectoryHit({ open_role_count: 40 }), null);
  });

  it("rejects a hit with a non-numeric open_role_count", () => {
    assert.equal(parseCompanyDirectoryHit({ domain: "acme.com", open_role_count: "lots" }), null);
  });

  it("rejects a hit with a missing open_role_count rather than treating it as zero", () => {
    // `Number(undefined)` is NaN (caught), but `Number(null)` is 0 and IS
    // finite — the exact false-zero this guard exists to reject.
    assert.equal(parseCompanyDirectoryHit({ domain: "acme.com", open_role_count: null }), null);
  });

  it("rejects a non-object hit", () => {
    assert.equal(parseCompanyDirectoryHit(null), null);
    assert.equal(parseCompanyDirectoryHit("acme.com"), null);
  });
});

describe("fetchIndexableCompanyDomains — the company_directory paging walk", () => {
  it("sends the MIN_SITEMAP_ROLES filter clause in the actual request, not just conceptually", async () => {
    const { calls, search } = fakeSearch([[{ domain: "acme.com", open_role_count: 40 }]]);
    await fetchIndexableCompanyDomains(search);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].filter, `open_role_count >= ${MIN_SITEMAP_ROLES}`);
    assert.equal(calls[0].offset, 0);
    assert.deepEqual(calls[0].sort, ["open_role_count:desc"]);
    assert.equal(calls[0].limit, DIRECTORY_POOL_SIZE);
  });

  it("walks multiple pages when sort fails, then caps by open role count", async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) => ({
      domain: `company-${i}.com`,
      open_role_count: 30 + (i % 5),
    }));
    let round = 0;
    const calls: { sort: string[]; filter: string; limit: number; offset: number }[] = [];
    const search = async (request: { sort: string[]; filter: string; limit: number; offset: number }) => {
      calls.push(request);
      if (request.sort.includes("open_role_count:desc")) {
        throw new Error("Meilisearch company_directory search failed: 400 code=invalid_search_sort");
      }
      const hits = round === 0 ? fullPage : [{ domain: "last.com", open_role_count: 26 }];
      round += 1;
      return { hits, total: 1001 };
    };
    const found = await fetchIndexableCompanyDomains(search);
    assert.equal(calls.length, 3);
    assert.equal(calls[1].offset, 0);
    assert.equal(calls[2].offset, 1000);
    assert.equal(found.length, 1001);
    assert.ok(found.some((d) => d.domain === "last.com"));
    assert.equal(found[0].openRoleCount, 34);
  });

  it("returns one sorted page when Meilisearch accepts open_role_count:desc", async () => {
    const { calls, search } = fakeSearch([
      [
        { domain: "big.com", open_role_count: 400 },
        { domain: "mid.com", open_role_count: 30 },
      ],
    ]);
    const found = await fetchIndexableCompanyDomains(search);
    assert.equal(calls.length, 1);
    assert.deepEqual(
      found.map((d) => d.domain),
      ["big.com", "mid.com"],
    );
  });

  it("a rejected sort pages the WHOLE filtered set and ranks it in memory, even when it exceeds the pool cap", async () => {
    const total = DIRECTORY_POOL_SIZE + 300;
    const all = Array.from({ length: total }, (_, i) => ({ domain: `c${String(i).padStart(5, "0")}.com`, open_role_count: 25 + (i % 97) }));
    const search = async (r: { sort: string[]; limit: number; offset: number }) =>
      r.sort[0] === "open_role_count:desc"
        ? Promise.reject(new Error("Meilisearch company_directory search failed: 400 code=invalid_search_sort"))
        : { hits: all.slice(r.offset, r.offset + r.limit), total };
    const found = await fetchIndexableCompanyDomains(search);
    const best = all.map((d) => d.open_role_count).sort((a, b) => b - a).slice(0, DIRECTORY_POOL_SIZE);
    assert.deepEqual(found.map((d) => d.openRoleCount), best);
  });

  it("throws, never returns a truncated pool, when the paged walk ends short of the reported total", async () => {
    const page = Array.from({ length: 1000 }, (_, i) => ({ domain: `c${i}.com`, open_role_count: 30 }));
    const search = async (r: { sort: string[]; offset: number }) =>
      r.sort[0] === "open_role_count:desc"
        ? Promise.reject(new Error("code=invalid_search_sort"))
        : { hits: r.offset === 0 ? page : [], total: 2500 }; // maxTotalHits-style cut: later pages come back empty
    await assert.rejects(() => fetchIndexableCompanyDomains(search), /read 1000 of 2500/);
  });

  it("throws when the ranked read returns fewer docs than min(cap, total)", async () => {
    const { search } = fakeSearch([[{ domain: "a.com", open_role_count: 40 }]], 5000);
    await assert.rejects(() => fetchIndexableCompanyDomains(search), /read 1 of 3700/);
  });

  it("a failure that is not a sort rejection (timeout, 5xx) propagates instead of falling back", async () => {
    const calls: string[] = [];
    const search = async (r: { sort: string[] }) => { calls.push(r.sort[0]!); throw new Error("This operation was aborted"); };
    await assert.rejects(() => fetchIndexableCompanyDomains(search), /aborted/);
    assert.deepEqual(calls, ["open_role_count:desc"]);
  });

  it("throws when the first page comes back with zero hits — directory not published yet", async () => {
    const { search } = fakeSearch([[]]);
    await assert.rejects(() => fetchIndexableCompanyDomains(search), /zero hits on the first page/);
  });

  it("skips a malformed doc within a page without aborting the rest of that page's valid hits", async () => {
    const { search } = fakeSearch([
      [
        { domain: "good.com", open_role_count: 40 },
        { open_role_count: 40 }, // missing domain
        { domain: "bad.com", open_role_count: "not-a-number" },
        { domain: "also-good.com", open_role_count: 30 },
      ],
    ]);
    const found = await fetchIndexableCompanyDomains(search);
    assert.deepEqual(
      found.map((d) => d.domain).sort(),
      ["also-good.com", "good.com"],
    );
  });

  it("throws immediately when Meilisearch isn't configured, before making any call", async () => {
    const original = process.env.MEILISEARCH_HOST;
    delete process.env.MEILISEARCH_HOST;
    try {
      let called = false;
      const search = async () => {
        called = true;
        return { hits: [], total: 0 };
      };
      await assert.rejects(() => fetchIndexableCompanyDomains(search));
      assert.equal(called, false);
    } finally {
      process.env.MEILISEARCH_HOST = original;
    }
  });
});

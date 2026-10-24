import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MIN_SITEMAP_ROLES,
  SITEMAP_COMPANY_CAP,
  fetchCompanyInSitemapSet,
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
    opened90d: null,
    closed90d: null,
    hasTrackRecord: false,
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
function fakeSearch(pages: Record<string, unknown>[][]) {
  const calls: { sort: string[]; filter: string; limit: number; offset: number }[] = [];
  let round = 0;
  const search = async (request: { sort: string[]; filter: string; limit: number; offset: number }) => {
    calls.push(request);
    const hits = pages[round] ?? [];
    round += 1;
    return { hits };
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

  it("a company just outside the cap is noindex,follow, with the same canonical", async () => {
    const hits = Array.from({ length: SITEMAP_COMPANY_CAP + 1 }, (_, i) => ({
      domain: i === SITEMAP_COMPANY_CAP ? "acme.com" : `c${i}.com`,
      open_role_count: 1000 - Math.floor(i / 10),
    }));
    const pages = [hits.slice(0, 1000), hits.slice(1000, 2000), hits.slice(2000, 3000), hits.slice(3000)];
    let round = 0;
    const search = async (req: { sort: string[] }) => {
      if (req.sort[0] === "open_role_count:desc") throw new Error("sort unavailable");
      return { hits: pages[round++] ?? [] };
    };
    const meta = await buildCompanyPageMetadata(
      company({ jobs: roles(40), facts: factsFor(40) }),
      (domain) => fetchCompanyInSitemapSet(domain, search),
    );
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

describe("fetchCompanyInSitemapSet — membership in the exact set sitemap.ts submits", () => {
  const hit = (domain: string, open_role_count: number) => ({ domain, open_role_count });

  it("is true for a domain the directory lists at or above MIN_SITEMAP_ROLES, filtering on that floor", async () => {
    const { search, calls } = fakeSearch([[hit("acme.com", MIN_SITEMAP_ROLES), hit("other.com", 90)]]);
    assert.equal(await fetchCompanyInSitemapSet("acme.com", search), true);
    assert.match(calls[0].filter, new RegExp(`open_role_count >= ${MIN_SITEMAP_ROLES}$`));
  });

  it("is false for a domain the set does not hold (below the floor is filtered out server-side)", async () => {
    const { search } = fakeSearch([[hit("other.com", 90)]]);
    assert.equal(await fetchCompanyInSitemapSet("acme.com", search), false);
  });

  it("is false for a domain past the cap: the lowest-count company of an over-full directory", async () => {
    const hits = Array.from({ length: SITEMAP_COMPANY_CAP + 1 }, (_, i) =>
      hit(i === SITEMAP_COMPANY_CAP ? "last.com" : `c${i}.com`, 1000 - Math.floor(i / 10)),
    );
    let sorted = true;
    const pages = [hits.slice(0, 1000), hits.slice(1000, 2000), hits.slice(2000, 3000), hits.slice(3000)];
    let round = 0;
    const search = async (req: { sort: string[] }) => {
      if (sorted && req.sort[0] === "open_role_count:desc") {
        sorted = false;
        throw new Error("sort unavailable");
      }
      return { hits: pages[round++] ?? [] };
    };
    assert.equal(await fetchCompanyInSitemapSet("last.com", search), false);
    assert.equal(await fetchCompanyInSitemapSet("c0.com", async () => ({ hits: pages[0] })), true);
  });

  it("is false and warns exactly once, rather than throwing, when the directory read fails", async () => {
    const originalWarn = console.warn;
    const warnings: unknown[][] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
    try {
      assert.equal(
        await fetchCompanyInSitemapSet("acme.com", async () => {
          throw new Error("meili down");
        }),
        false,
      );
      assert.equal(warnings.length, 1);
    } finally {
      console.warn = originalWarn;
    }
  });

  it("is false without calling search when Meilisearch isn't configured", async () => {
    const original = process.env.MEILISEARCH_HOST;
    delete process.env.MEILISEARCH_HOST;
    try {
      let called = false;
      const result = await fetchCompanyInSitemapSet("acme.com", async () => {
        called = true;
        return { hits: [] };
      });
      assert.equal(result, false);
      assert.equal(called, false);
    } finally {
      process.env.MEILISEARCH_HOST = original;
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
      company({ jobs: roles(0), openCount: 0, hasTrackRecord: true, opened90d: 5, closed90d: 2, facts: factsFor(0) }),
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
    assert.equal(calls[0].limit, SITEMAP_COMPANY_CAP);
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
        throw new Error("sort not configured");
      }
      const hits = round === 0 ? fullPage : [{ domain: "last.com", open_role_count: 26 }];
      round += 1;
      return { hits };
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
        return { hits: [] };
      };
      await assert.rejects(() => fetchIndexableCompanyDomains(search));
      assert.equal(called, false);
    } finally {
      process.env.MEILISEARCH_HOST = original;
    }
  });
});

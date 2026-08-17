import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MIN_INDEXABLE_ROLES,
  fetchIndexableCompanyDomains,
  hasIndexableCompanyContent,
  isCompanyIndexable,
  parseCompanyDirectoryHit,
} from "@/lib/companies/indexable";
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

function company(overrides: Partial<CompanyPageData> = {}): CompanyPageData {
  const jobs = overrides.jobs ?? roles(5);
  return {
    domain: "acme.com",
    slug: "acme--com",
    name: "Acme",
    nameSource: "corpus-cased",
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
    ...overrides,
    jobs,
  };
}

describe("isCompanyIndexable — the /co/[slug] robots + sitemap gate", () => {
  it("passes a company with real inventory and no track record at all", () => {
    // The load-bearing case: `hasTrackRecord` is false for 100% of employers
    // today (no `company_*` fields in the live index). If it were a
    // precondition rather than an upgrade, every page would go noindex.
    assert.equal(isCompanyIndexable(company({ jobs: roles(40), hasTrackRecord: false })), true);
  });

  it("fails a company with zero live roles", () => {
    assert.equal(isCompanyIndexable(company({ jobs: roles(0), openCount: 0 })), false);
  });

  it("fails a thin page when the track-record KPIs are absent", () => {
    assert.equal(isCompanyIndexable(company({ jobs: roles(1), hasTrackRecord: false })), false);
  });

  it("treats the threshold as a floor, not a ceiling", () => {
    assert.equal(isCompanyIndexable(company({ jobs: roles(MIN_INDEXABLE_ROLES - 1) })), false);
    assert.equal(isCompanyIndexable(company({ jobs: roles(MIN_INDEXABLE_ROLES) })), true);
  });

  it("lets a track record UPGRADE a page the role count alone would reject", () => {
    // Proves the OR: when the `company_*` aggregate sync lands, a company
    // with a real 90-day history becomes indexable with no code change.
    assert.equal(
      isCompanyIndexable(company({ jobs: roles(0), openCount: 0, hasTrackRecord: true })),
      true,
    );
  });

  it("still indexes a company whose display name was derived from its domain", () => {
    // The checkout.com class (measured 2026-08-11: 184 live roles,
    // nameSource "domain" because its corpus `company` string is its own
    // domain). Inventory decides indexation; a name defect does not.
    assert.equal(
      isCompanyIndexable(company({ jobs: roles(184), nameSource: "domain" })),
      true,
    );
  });

  it("does not let an inflated openCount buy indexation for a page with one role", () => {
    // `openCount` can claim roles the page never renders. The gate counts
    // rendered roles, so a stale aggregate cannot talk its way into the
    // sitemap.
    assert.equal(isCompanyIndexable(company({ jobs: roles(1), openCount: 184 })), false);
  });

  it("reads an omitted hasTrackRecord as unobserved, not as a false claim", () => {
    // The shape sitemap.ts passes: an aggregation query can count roles but
    // cannot see the KPIs, so it omits the field entirely.
    assert.equal(hasIndexableCompanyContent({ openRoleCount: 40 }), true);
    assert.equal(hasIndexableCompanyContent({ openRoleCount: 1 }), false);
  });
});

describe("/co/[slug] metadata", () => {
  it("emits a self-referencing canonical on an indexable page", () => {
    const meta = buildCompanyPageMetadata(company({ jobs: roles(40) }));
    assert.equal(meta.alternates?.canonical, "/co/acme--com");
    assert.equal(meta.robots, undefined);
  });

  it("emits the SAME canonical on a noindex page, with follow retained", () => {
    // A de-indexed page still has to declare which URL it is — that is what
    // consolidates the intervu.cc -> intervuhq.com and /companies/[slug]
    // redirect paths onto one address.
    const meta = buildCompanyPageMetadata(company({ jobs: roles(0), openCount: 0 }));
    assert.equal(meta.alternates?.canonical, "/co/acme--com");
    assert.deepEqual(meta.robots, { index: false, follow: true });
  });

  it("builds the canonical from the domain, so it matches the sitemap's URL", () => {
    const meta = buildCompanyPageMetadata(company({ domain: "1password.com", jobs: roles(59) }));
    assert.equal(meta.alternates?.canonical, "/co/1password--com");
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
  /** Records every request `fetchIndexableCompanyDomains` sent, and replies
   *  with one fixed page per call (or `{ hits: [] }` past the end of
   *  `pages`) — so a test can assert on the exact request shape (the filter
   *  clause, the offset progression) without a network call. */
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

  it("sends the MIN_INDEXABLE_ROLES filter clause in the actual request, not just conceptually", async () => {
    const { calls, search } = fakeSearch([[{ domain: "acme.com", open_role_count: 40 }]]);
    await fetchIndexableCompanyDomains(search);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].filter, `open_role_count >= ${MIN_INDEXABLE_ROLES}`);
    assert.equal(calls[0].offset, 0);
  });

  it("walks multiple pages, advancing the offset by the page size each round, until a short page ends it", async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) => ({
      domain: `company-${i}.com`,
      open_role_count: 10,
    }));
    const { calls, search } = fakeSearch([fullPage, [{ domain: "last.com", open_role_count: 5 }]]);
    const found = await fetchIndexableCompanyDomains(search);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].offset, 0);
    assert.equal(calls[1].offset, 1000);
    assert.equal(found.length, 1001);
    assert.ok(found.some((d) => d.domain === "last.com"));
  });

  it("stops after the first page once it comes back short of the page size", async () => {
    const { calls, search } = fakeSearch([
      [{ domain: "a.com", open_role_count: 40 }, { domain: "b.com", open_role_count: 12 }],
    ]);
    const found = await fetchIndexableCompanyDomains(search);
    assert.equal(calls.length, 1);
    assert.deepEqual(
      found.map((d) => d.domain).sort(),
      ["a.com", "b.com"],
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
        { domain: "also-good.com", open_role_count: 12 },
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

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MIN_INDEXABLE_ROLES,
  fetchCompanySnapshotRoleCount,
  fetchIndexableCompanyDomains,
  parseCompanyDirectoryHit,
  resolveCompanyIndexability,
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

describe("resolveCompanyIndexability — the /co/[slug] sitemap + robots seam", () => {
  it("holds the invariant inSitemap ⇒ pageIndexable for every input", () => {
    // The class-wide guarantee the seam exists to make structural, not
    // conventional: no (snapshot, live) pair can ever list a URL in the
    // sitemap that the page itself marks noindex.
    for (const snapshotRoleCount of [null, 0, 1, 2, 3, 7]) {
      for (const liveRoleCount of [0, 1, 2, 3, 7]) {
        const { inSitemap, pageIndexable } = resolveCompanyIndexability({ snapshotRoleCount, liveRoleCount });
        assert.ok(
          !inSitemap || pageIndexable,
          `snapshot=${snapshotRoleCount} live=${liveRoleCount}: inSitemap was true but pageIndexable was false`,
        );
      }
    }
  });

  it("the surfaced drift case: a sitemap-listed company whose live count has since dipped stays indexable", () => {
    // The exact bug this seam closes: the old page path read ONLY
    // `jobs.length` (2) and noindexed a URL the sitemap still listed off a
    // snapshot of 5 — a recurring GSC "Submitted URL marked noindex".
    const result = resolveCompanyIndexability({ snapshotRoleCount: 5, liveRoleCount: 2 });
    assert.equal(result.inSitemap, true);
    assert.equal(result.pageIndexable, true);
  });

  it("a rising company ahead of the snapshot: indexable, but correctly absent from the sitemap", () => {
    assert.deepEqual(resolveCompanyIndexability({ snapshotRoleCount: null, liveRoleCount: 4 }), {
      inSitemap: false,
      pageIndexable: true,
    });
  });

  it("a snapshot-qualified company with zero live roles this instant: both true, the sitemap's measurement wins", () => {
    assert.deepEqual(resolveCompanyIndexability({ snapshotRoleCount: 3, liveRoleCount: 0 }), {
      inSitemap: true,
      pageIndexable: true,
    });
  });

  it("treats the threshold as a floor on both inputs independently", () => {
    assert.equal(
      resolveCompanyIndexability({ snapshotRoleCount: MIN_INDEXABLE_ROLES - 1, liveRoleCount: 0 }).inSitemap,
      false,
    );
    assert.equal(
      resolveCompanyIndexability({ snapshotRoleCount: MIN_INDEXABLE_ROLES, liveRoleCount: 0 }).inSitemap,
      true,
    );
  });
});

describe("fetchCompanySnapshotRoleCount — the page path's single-doc company_directory lookup", () => {
  it("reads the domain's open_role_count off the matching hit", async () => {
    const { search } = fakeSearch([[{ domain: "acme.com", open_role_count: 5 }]]);
    assert.equal(await fetchCompanySnapshotRoleCount("acme.com", search), 5);
  });

  it("returns null on a doc miss — not in the directory, correctly excluded from the sitemap side of the OR", async () => {
    const { search } = fakeSearch([[]]);
    assert.equal(await fetchCompanySnapshotRoleCount("acme.com", search), null);
  });

  it("returns null and warns exactly once, rather than throwing, when the Meilisearch request fails", async () => {
    const originalWarn = console.warn;
    const warnings: unknown[][] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
    try {
      const result = await fetchCompanySnapshotRoleCount("acme.com", async () => {
        throw new Error("meili down");
      });
      assert.equal(result, null);
      assert.equal(warnings.length, 1);
    } finally {
      console.warn = originalWarn;
    }
  });

  it("returns null without calling search when Meilisearch isn't configured", async () => {
    const original = process.env.MEILISEARCH_HOST;
    delete process.env.MEILISEARCH_HOST;
    try {
      let called = false;
      const result = await fetchCompanySnapshotRoleCount("acme.com", async () => {
        called = true;
        return { hits: [] };
      });
      assert.equal(result, null);
      assert.equal(called, false);
    } finally {
      process.env.MEILISEARCH_HOST = original;
    }
  });
});

describe("/co/[slug] metadata", () => {
  /** Stubs the snapshot lookup so these tests exercise only
   *  `buildCompanyPageMetadata`'s own logic, never the network — same DI
   *  `fetchCompanySnapshotRoleCount` itself takes. */
  function stubSnapshot(count: number | null) {
    return async () => count;
  }

  it("emits a self-referencing canonical on an indexable page (live count alone qualifies)", async () => {
    const meta = await buildCompanyPageMetadata(company({ jobs: roles(40) }), stubSnapshot(null));
    assert.equal(meta.alternates?.canonical, "/co/acme--com");
    assert.equal(meta.robots, undefined);
  });

  it("emits the SAME canonical on a noindex page, with follow retained", async () => {
    // A de-indexed page still has to declare which URL it is — that is what
    // consolidates the intervu.cc -> intervuhq.com and /companies/[slug]
    // redirect paths onto one address.
    const meta = await buildCompanyPageMetadata(
      company({ jobs: roles(0), openCount: 0, hasTrackRecord: false }),
      stubSnapshot(null),
    );
    assert.equal(meta.alternates?.canonical, "/co/acme--com");
    assert.deepEqual(meta.robots, { index: false, follow: true });
  });

  it("builds the canonical from the domain, so it matches the sitemap's URL", async () => {
    const meta = await buildCompanyPageMetadata(
      company({ domain: "1password.com", jobs: roles(59) }),
      stubSnapshot(null),
    );
    assert.equal(meta.alternates?.canonical, "/co/1password--com");
  });

  it("stays indexable when live roles have dipped below a snapshot the sitemap already lists — the surfaced bug", async () => {
    const meta = await buildCompanyPageMetadata(company({ jobs: roles(2) }), stubSnapshot(5));
    assert.equal(meta.robots, undefined);
  });

  it("does not let an inflated openCount buy indexation — the live count is jobs.length, never openCount", async () => {
    // `openCount` can claim roles the page never renders. The gate counts
    // rendered roles, so a stale aggregate cannot talk its way past noindex.
    const meta = await buildCompanyPageMetadata(
      company({ jobs: roles(1), openCount: 184 }),
      stubSnapshot(null),
    );
    assert.deepEqual(meta.robots, { index: false, follow: true });
  });

  it("lets a track record UPGRADE a page neither role count alone would qualify", async () => {
    // Proves the OR: when the `company_*` aggregate sync lands, a company
    // with a real 90-day history becomes indexable with no code change.
    const meta = await buildCompanyPageMetadata(
      company({ jobs: roles(0), openCount: 0, hasTrackRecord: true }),
      stubSnapshot(null),
    );
    assert.equal(meta.robots, undefined);
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

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_DOMAIN_DISCOVERY_ROUNDS,
  MIN_INDEXABLE_ROLES,
  buildDomainDiscoveryFilter,
  fetchIndexableCompanyDomains,
  hasIndexableCompanyContent,
  isCompanyIndexable,
  processDomainDiscoveryRound,
} from "@/lib/companies/indexable";
import {
  buildCompanyPageMetadata,
  companyMetaDescription,
  ghostPctCoversAllRoles,
  openCountText,
} from "@/lib/companies/presentation";
import type { CompanyPageData } from "@/lib/companies/types";
import { LIVE_VACANCY_FILTER } from "@/lib/jobs/meilisearch";
import type { MeiliAggregationQuery, MeiliAggregationResult } from "@/lib/jobs/meilisearch";
import type { PublicJob } from "@/lib/jobs/types";

process.env.NEXT_PUBLIC_SITE_URL = "https://intervuhq.com";
// The guard in `fetchIndexableCompanyDomains` only checks that a host is
// configured; every test below injects its own fake `multiSearch`, so no
// real network call is ever made against this value.
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

  it("knows when the ghost-flagged share covers only the fetched window", () => {
    assert.equal(ghostPctCoversAllRoles({ jobs: roles(200), openCount: 940 }), false);
    assert.equal(ghostPctCoversAllRoles({ jobs: roles(12), openCount: 12 }), true);
  });
});

describe("buildDomainDiscoveryFilter — one round's Meilisearch filter", () => {
  it("carries only the live-vacancy baseline on the first round", () => {
    assert.deepEqual(buildDomainDiscoveryFilter([]), [LIVE_VACANCY_FILTER]);
  });

  it("excludes every domain already collected on later rounds", () => {
    assert.deepEqual(buildDomainDiscoveryFilter(["acme.com", "beta.io"]), [
      LIVE_VACANCY_FILTER,
      'company_domain NOT IN ["acme.com", "beta.io"]',
    ]);
  });
});

describe("processDomainDiscoveryRound — one facet-distribution page", () => {
  it("keeps only domains that clear the gate, from a mixed page", () => {
    const outcome = processDomainDiscoveryRound({
      "big.com": 40,
      "thin.com": MIN_INDEXABLE_ROLES - 1,
      "exact.com": MIN_INDEXABLE_ROLES,
    });
    assert.equal(outcome.exhausted, false);
    assert.deepEqual(
      outcome.indexable.map((d) => d.domain).sort(),
      ["big.com", "exact.com"],
    );
  });

  it("reads an empty page as exhaustion, not as zero indexable domains found this round", () => {
    const outcome = processDomainDiscoveryRound({});
    assert.equal(outcome.exhausted, true);
    assert.deepEqual(outcome.indexable, []);
  });
});

describe("fetchIndexableCompanyDomains — the multi-round discovery walk", () => {
  /** Records every query `fetchIndexableCompanyDomains` sent, so a test can
   *  assert on the pagination boundary (what round 2's NOT IN excludes)
   *  without a network call. */
  type MultiSearchFn = (queries: MeiliAggregationQuery[]) => Promise<MeiliAggregationResult[]>;

  function fakeMultiSearch(
    pages: Record<string, number>[],
  ): { calls: MeiliAggregationQuery[][]; multiSearch: MultiSearchFn } {
    const calls: MeiliAggregationQuery[][] = [];
    let round = 0;
    const multiSearch: MultiSearchFn = async (queries) => {
      calls.push(queries);
      const page = pages[round] ?? {};
      round += 1;
      return [{ facetDistribution: { company_domain: page } }];
    };
    return { calls, multiSearch };
  }

  it("walks past the per-query cap: round 2 excludes everything round 1 already saw", async () => {
    const { calls, multiSearch } = fakeMultiSearch([
      { "a.com": 40, "b.com": 12 },
      {}, // exhausted
    ]);
    const found = await fetchIndexableCompanyDomains(multiSearch);
    assert.deepEqual(
      found.map((d) => d.domain).sort(),
      ["a.com", "b.com"],
    );
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0][0].filter, [LIVE_VACANCY_FILTER]);
    assert.deepEqual(calls[1][0].filter, [
      LIVE_VACANCY_FILTER,
      'company_domain NOT IN ["a.com", "b.com"]',
    ]);
  });

  it("drops sub-threshold domains found mid-walk without stopping the walk", async () => {
    const { multiSearch } = fakeMultiSearch([
      { "big.com": 40, "thin.com": 1 },
      { "also-big.com": 5 },
      {},
    ]);
    const found = await fetchIndexableCompanyDomains(multiSearch);
    assert.deepEqual(
      found.map((d) => d.domain).sort(),
      ["also-big.com", "big.com"],
    );
  });

  it("throws rather than silently truncating when the corpus never exhausts", async () => {
    // A pathological feed that always has one more never-before-seen domain
    // — the walk must give up loudly at the round cap, not return a partial
    // list as if it were complete.
    let round = 0;
    const neverExhausts = async (): Promise<MeiliAggregationResult[]> => {
      round += 1;
      return [{ facetDistribution: { company_domain: { [`domain-${round}.com`]: 10 } } }];
    };
    await assert.rejects(
      () => fetchIndexableCompanyDomains(neverExhausts),
      /did not exhaust the corpus within \d+ rounds/,
    );
    assert.equal(round, MAX_DOMAIN_DISCOVERY_ROUNDS);
  });

  it("throws immediately when Meilisearch isn't configured, before making any call", async () => {
    const original = process.env.MEILISEARCH_HOST;
    delete process.env.MEILISEARCH_HOST;
    try {
      let called = false;
      const multiSearch = async (): Promise<MeiliAggregationResult[]> => {
        called = true;
        return [];
      };
      await assert.rejects(() => fetchIndexableCompanyDomains(multiSearch));
      assert.equal(called, false);
    } finally {
      process.env.MEILISEARCH_HOST = original;
    }
  });
});

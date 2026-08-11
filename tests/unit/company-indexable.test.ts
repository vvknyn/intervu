import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MIN_INDEXABLE_ROLES,
  hasIndexableCompanyContent,
  isCompanyIndexable,
} from "@/lib/companies/indexable";
import {
  buildCompanyPageMetadata,
  companyMetaDescription,
  ghostPctCoversAllRoles,
  openCountText,
} from "@/lib/companies/presentation";
import type { CompanyPageData } from "@/lib/companies/types";
import type { PublicJob } from "@/lib/jobs/types";

process.env.NEXT_PUBLIC_SITE_URL = "https://intervuhq.com";

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

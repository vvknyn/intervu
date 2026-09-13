import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CompanyRoleSearch } from "../../src/components/company/CompanyRoleSearch";
import { CompanyRolesList } from "../../src/components/company/CompanyRolesList";
import type { PublicJob } from "../../src/lib/jobs/types";

/**
 * Guards the artifact-spec redesign's meta chokepoint (item 3) and
 * exception-only status (item 4) on BOTH role-row renderers —
 * `CompanyRoleSearch` (/co) and `CompanyRolesList` (/companies/[slug]).
 * Each used to hand-roll its own location-first `roleMeta()` and print
 * `GHOST_META.clear.label` ("Actively posted") on every routine row; both
 * now read `buildFactChips` + `MetaLine` (CompanyJobRow, mirroring JobCard)
 * and `rowExceptionMeta` (lib/jobs/presentation.ts), the same fact grammar
 * and exception-only rule the SERP row already applies.
 */

const NOW = Date.parse("2026-08-21T12:00:00Z");
const FRESH = new Date(NOW - 86_400_000).toISOString(); // 1 day ago
const STALE = new Date(NOW - 40 * 86_400_000).toISOString(); // > STALE_CHECK_DAYS (30)

function job(overrides: Partial<PublicJob> & Pick<PublicJob, "id">): PublicJob {
  return {
    title: "Backend Engineer",
    company: "Acme",
    company_domain: "acme.example",
    location: null,
    location_city: "Austin",
    location_state: "TX",
    location_country: "United States",
    work_type: "onsite",
    description: null,
    employment_type: "full_time",
    experience_level: "mid",
    salary_min: 120_000,
    salary_max: 150_000,
    salary_currency: "USD",
    salary_period: "year",
    visa_sponsorship: null,
    tags: [],
    apply_url: "https://example.com",
    source: "test",
    posted_at: null,
    first_seen_at: null,
    updated_at: null,
    vacancy_status: "open",
    ghost_badge: "clear",
    ghost_checked_at: FRESH,
    ...overrides,
  };
}

function renderRoleSearch(jobs: PublicJob[]): string {
  return renderToStaticMarkup(
    React.createElement(CompanyRoleSearch, {
      jobs,
      companyDomain: "acme.example",
      companySlug: "acme--example",
      companyName: "Acme",
      openCountLabel: String(jobs.length),
      searchesPartialWindow: false,
      jobsSearchUrl: "/jobs?companyDomain=acme.example",
      now: NOW,
    }),
  );
}

function renderRolesList(roles: PublicJob[]): string {
  return renderToStaticMarkup(
    React.createElement(CompanyRolesList, {
      roles,
      jobsSearchUrl: "/jobs?companyDomain=acme.example",
      now: NOW,
    }),
  );
}

test("CompanyRoleSearch: the row meta line renders location and salary via MetaLine (JobCard fact grammar)", () => {
  const html = renderRoleSearch([job({ id: "1" })]);
  assert.match(html, /120k/, "salary must render on the meta line");
  assert.match(html, /Austin/, "location must render on the meta line");
});

test("CompanyRoleSearch: a clear+fresh row renders no status line", () => {
  const html = renderRoleSearch([job({ id: "1", ghost_badge: "clear", ghost_checked_at: FRESH })]);
  assert.doesNotMatch(html, /Actively posted/);
  assert.doesNotMatch(html, /●/);
});

test("CompanyRoleSearch: a stale-clear row still renders 'Not recently verified'", () => {
  const html = renderRoleSearch([job({ id: "1", ghost_badge: "clear", ghost_checked_at: STALE })]);
  assert.match(html, /Not recently verified/);
});

test("CompanyRoleSearch: no per-row logo renders — the hero carries the logo, not each role row", () => {
  const html = renderRoleSearch([job({ id: "1" })]);
  assert.doesNotMatch(html, /<img/);
});

test("CompanyRolesList: the row meta line renders location and salary via MetaLine (JobCard fact grammar)", () => {
  const html = renderRolesList([job({ id: "1" })]);
  assert.match(html, /120k/, "salary must render on the meta line");
  assert.match(html, /Austin/, "location must render on the meta line");
});

test("CompanyRolesList: a clear+fresh row renders no status pill", () => {
  const html = renderRolesList([job({ id: "1", ghost_badge: "clear", ghost_checked_at: FRESH })]);
  assert.doesNotMatch(html, /Actively posted/);
});

test("CompanyRolesList: a stale-clear row still renders 'Not recently verified'", () => {
  const html = renderRolesList([job({ id: "1", ghost_badge: "clear", ghost_checked_at: STALE })]);
  assert.match(html, /Not recently verified/);
});

/**
 * Dedup contract: `CompanyRoleSearch` no longer runs `collapseDuplicatePostings`
 * itself (moved to lib/companies/dedupe-postings.ts — see
 * company-dedupe-postings.test.ts) — `getCompanyPageData` (get-company.ts)
 * dedupes once, server-side, and hands this component the final array. This
 * locks in that the component trusts its `jobs` prop as-is: a duplicate
 * posting that reaches it (e.g. a caller that hasn't deduped) renders as two
 * rows, not one, so a regression that re-adds a second, disagreeing dedup
 * pass inside the component is easy to tell apart from this contract.
 */
test("CompanyRoleSearch: renders exactly the jobs it's given — no dedup of its own", () => {
  const first = job({ id: "1", title: "Escrow Operations Intern", salary_min: 40_000 });
  const dupe = job({ id: "2", title: "Escrow Operations Intern", salary_min: 45_000 });
  const html = renderRoleSearch([first, dupe]);
  assert.equal((html.match(/Escrow Operations Intern/g) || []).length, 2);
});

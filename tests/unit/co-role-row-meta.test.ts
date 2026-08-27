import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CompanyRoleSearch, collapseDuplicatePostings } from "../../src/components/company/CompanyRoleSearch";
import { CompanyRolesList } from "../../src/components/company/CompanyRolesList";
import type { PublicJob } from "../../src/lib/jobs/types";

/**
 * Guards the artifact-spec redesign's meta chokepoint (item 3) and
 * exception-only status (item 4) on BOTH role-row renderers —
 * `CompanyRoleSearch` (/co) and `CompanyRolesList` (/companies/[slug]).
 * Each used to hand-roll its own location-first `roleMeta()` and print
 * `GHOST_META.clear.label` ("Actively posted") on every routine row; both
 * now read `companyRowMetaSegments` (lib/presentation/job.ts) and
 * `rowExceptionMeta` (lib/jobs/presentation.ts), the same salary-first
 * chokepoint and exception-only rule the SERP row already applies.
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

test("CompanyRoleSearch: the row meta line is salary-first (buildRowMetaLine), not the old location-first roleMeta()", () => {
  const html = renderRoleSearch([job({ id: "1" })]);
  const salaryIdx = html.indexOf("120k");
  const locationIdx = html.indexOf("Austin");
  assert.ok(salaryIdx !== -1 && locationIdx !== -1, "both salary and location must render");
  assert.ok(salaryIdx < locationIdx, "salary must render before location — salary-first, not location-first");
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

test("CompanyRolesList: the row meta line is salary-first (buildRowMetaLine), not the old location-first roleMeta()", () => {
  const html = renderRolesList([job({ id: "1" })]);
  const salaryIdx = html.indexOf("120k");
  const locationIdx = html.indexOf("Austin");
  assert.ok(salaryIdx !== -1 && locationIdx !== -1, "both salary and location must render");
  assert.ok(salaryIdx < locationIdx, "salary must render before location — salary-first, not location-first");
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
 * `collapseDuplicatePostings` — the same role re-synced under a second id
 * (live example: Stewart's "Escrow Operations Intern", ingested twice).
 * Keyed on title + `locationText`, the same text the row itself renders, so
 * two rows a visitor can't tell apart never render as two.
 */
test("collapseDuplicatePostings: same title+location, a non-display field differs (id, salary) — collapses to the first", () => {
  const first = job({ id: "1", title: "Escrow Operations Intern", salary_min: 40_000 });
  const dupe = job({ id: "2", title: "Escrow Operations Intern", salary_min: 45_000 });
  assert.deepEqual(collapseDuplicatePostings([first, dupe]), [first]);
});

test("collapseDuplicatePostings: a URL-encoded/whitespace-only title difference is a distinct duplication pattern that also collapses", () => {
  const first = job({ id: "1", title: "Escrow%20Operations%20Intern" });
  const dupe = job({ id: "2", title: "  ESCROW OPERATIONS INTERN  " });
  assert.equal(collapseDuplicatePostings([first, dupe]).length, 1);
});

test("collapseDuplicatePostings: a genuinely different posting (different location) is kept alongside the first", () => {
  const a = job({ id: "1", title: "Escrow Operations Intern", location_city: "Edmond" });
  const b = job({ id: "2", title: "Escrow Operations Intern", location_city: "Houston" });
  assert.deepEqual(collapseDuplicatePostings([a, b]), [a, b]);
});

test("collapseDuplicatePostings: an empty list stays empty", () => {
  assert.deepEqual(collapseDuplicatePostings([]), []);
});

test("CompanyRoleSearch: a duplicated posting renders as one row, not two", () => {
  const first = job({ id: "1", title: "Escrow Operations Intern", salary_min: 40_000 });
  const dupe = job({ id: "2", title: "Escrow Operations Intern", salary_min: 45_000 });
  const html = renderRoleSearch([first, dupe]);
  assert.equal((html.match(/Escrow Operations Intern/g) || []).length, 1);
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CompanyRoleSearch } from "../../src/components/company/CompanyRoleSearch";
import type { PublicJob } from "../../src/lib/jobs/types";

/**
 * Guards the 2026-08-20 `/co/[slug]` redesign — the owner's verbatim
 * complaint was "the company page still looks amateur" / "you did not
 * redesign the company pages": a job seeker's first screen contained zero
 * jobs, an internal-tier "ELITE" badge, a 4-tile KPI dashboard, and a
 * "Company Intelligence & Insights" section with "TECH DNA" and "DETECTED
 * TECHNOLOGY STACK" copy — all above the fold, all before a single role.
 *
 * Follows this repo's own precedent for a component tree it cannot safely
 * render whole (`page.tsx` is an async Server Component that fetches from
 * the network — see tests/unit/landing-plain-copy.test.ts's chip-row test
 * for the same "read the source, don't render the page" call) — the
 * vocabulary guard and the roles-before-secondary-content ordering check are
 * both cheaper and just as authoritative as a render for a `grep`-shaped
 * question like "is this word gone" / "does A come before B in the JSX".
 */

const CO_PAGE = join(__dirname, "..", "..", "src", "app", "co", "[slug]", "page.tsx");
/** The page's composed tree (header, roles, rail, bands). page.tsx fetches
 *  and hands the data to this component, which /mock/company-page also
 *  renders with fixtures. */
const CO_PAGE_BODY = join(__dirname, "..", "..", "src", "components", "company", "CompanyPageBody.tsx");
const INTEL_GRID = join(__dirname, "..", "..", "src", "components", "company", "CompanyIntelligenceGrid.tsx");
const ROLE_SEARCH = join(__dirname, "..", "..", "src", "components", "company", "CompanyRoleSearch.tsx");
const CHANGE_EVENTS = join(__dirname, "..", "..", "src", "components", "company", "CompanyChangeEvents.tsx");

/** Comments are where the redesign's own docblocks legitimately name the
 *  retired vocabulary (this file's own doc comment above does too) — only
 *  what ships to the browser is in scope, same rule landing-plain-copy.test.ts
 *  applies to its own vocabulary guard. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\w])\/\/[^\n]*/g, "$1");
}

const BANNED_TERMS = ["ELITE", "TECH DNA", "DETECTED", "COMPANY INTELLIGENCE & INSIGHTS", "POSSIBLY STALE"];

describe("/co/[slug]: retired back-office vocabulary is gone from the component tree", () => {
  for (const [label, file] of [
    ["page.tsx", CO_PAGE],
    ["CompanyPageBody.tsx", CO_PAGE_BODY],
    ["CompanyIntelligenceGrid.tsx", INTEL_GRID],
    ["CompanyRoleSearch.tsx", ROLE_SEARCH],
    ["CompanyChangeEvents.tsx", CHANGE_EVENTS],
  ] as const) {
    it(`${label} carries none of the retired terms`, () => {
      const source = stripComments(readFileSync(file, "utf8")).toUpperCase();
      const offenders = BANNED_TERMS.filter((term) => source.includes(term));
      assert.deepEqual(offenders, [], `${label} still contains: ${offenders.join(", ")}`);
    });
  }
});

describe("/co/[slug]: roles list renders before secondary (intel/hiring-activity) content", () => {
  it("<CompanyRoleSearch appears before the company-secondary wrapper in the composed tree", () => {
    const source = readFileSync(CO_PAGE_BODY, "utf8");
    const rolesIndex = source.indexOf("<CompanyRoleSearch");
    const secondaryIndex = source.indexOf('data-testid="company-secondary"');
    assert.ok(rolesIndex !== -1, "CompanyPageBody.tsx no longer renders <CompanyRoleSearch — did the marker move?");
    assert.ok(secondaryIndex !== -1, 'CompanyPageBody.tsx no longer has a data-testid="company-secondary" wrapper');
    assert.ok(
      rolesIndex < secondaryIndex,
      "the roles list must render before the demoted secondary content, not after",
    );
  });

  it("the intelligence grid sits in the secondary wrapper, after the public sections", () => {
    const source = readFileSync(CO_PAGE_BODY, "utf8");
    const sectionsIndex = source.indexOf("<CompanySections");
    const secondaryIndex = source.indexOf('data-testid="company-secondary"');
    const intelIndex = source.indexOf("<CompanyIntelligenceGrid");
    assert.ok(sectionsIndex !== -1 && sectionsIndex < secondaryIndex, "the public sections must come before the gated block");
    assert.ok(secondaryIndex < intelIndex, "CompanyIntelligenceGrid moved ahead of the secondary wrapper");
  });
});

// S2-B: the header's fact row and the gated rail are gone; the facts are public
// sections (identity, hiringNow, listingHealth ...) rendered from `CompanyFacts`.
describe("/co/[slug]: facts are public sections, not a header row or a gated rail", () => {
  it("the header no longer builds its own fact row, and has no rail", () => {
    const source = readFileSync(CO_PAGE_BODY, "utf8");
    assert.doesNotMatch(source, /buildCompanyFacts\(|facts\.hiringGeos|data-testid="company-rail"/);
    assert.doesNotMatch(source, /(?<![-\w])font-mono(?![-\w])/);
  });

  it("hiring record and list health are public sections, not behind the follow gate", () => {
    const source = readFileSync(CO_PAGE_BODY, "utf8");
    assert.doesNotMatch(source, /company-intel-gate-record/);
    const sections = readFileSync("src/components/company/CompanySections.tsx", "utf8");
    assert.match(sections, /listingHealth:/);
    assert.match(sections, /hiringNow:/);
  });
});

describe("/co/[slug]: Recent changes mounts once", () => {
  it("CompanyChangeEvents appears once — not once per gate (follow vs sign-in)", () => {
    const source = stripComments(readFileSync(CO_PAGE_BODY, "utf8"));
    const mounts = source.match(/<CompanyChangeEvents/g) ?? [];
    assert.equal(mounts.length, 1, `expected one Recent changes list, found ${mounts.length}`);
  });
});

function job(overrides: Partial<PublicJob> & Pick<PublicJob, "id">): PublicJob {
  return {
    title: "Engineer",
    company: "Acme",
    company_domain: "acme.example",
    location: null,
    location_city: null,
    location_state: null,
    location_country: null,
    work_type: "remote",
    description: null,
    employment_type: "full_time",
    experience_level: "mid",
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_period: null,
    visa_sponsorship: null,
    tags: [],
    apply_url: "https://example.com",
    source: "test",
    posted_at: null,
    first_seen_at: null,
    updated_at: null,
    vacancy_status: "open",
    ghost_badge: "clear",
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
      now: Date.now(),
    }),
  );
}

describe("CompanyRoleSearch: two company shapes", () => {
  it("shape 1 — zero open roles keeps the existing follow-first empty state (no regression)", () => {
    const html = renderRoleSearch([]);
    assert.match(html, /No open roles right now\. Follow Acme/);
    assert.match(html, /data-testid="follow-company"/);
    assert.doesNotMatch(html, /<ul/, "an empty roster must not render a (necessarily empty) role list");
  });

  it("shape 2 — a company with an open role renders it through locationSummary, not the raw ATS breadcrumb", () => {
    const html = renderRoleSearch([
      job({
        id: "1",
        location: "Waterloo, Ontario, CAN, N2L 0A1",
        location_city: null,
        location_state: null,
        location_country: null,
        work_type: "onsite",
      }),
    ]);
    assert.match(html, /Waterloo, Ontario, CAN/, "locationSummary's cleaned string must render");
    assert.doesNotMatch(html, /N2L 0A1/, "the raw trailing postal code must not reach the rendered row");
  });
});

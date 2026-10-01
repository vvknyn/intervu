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

  it("the intelligence grid sits in the secondary wrapper and the hiring record in the rail, both after the roles", () => {
    const source = readFileSync(CO_PAGE_BODY, "utf8");
    const rolesIndex = source.indexOf("<CompanyRoleSearch");
    const secondaryIndex = source.indexOf('data-testid="company-secondary"');
    const intelIndex = source.indexOf("<CompanyIntelligenceGrid");
    const railIndex = source.indexOf('data-testid="company-rail"');
    const hiringActivityIndex = source.indexOf('data-testid="company-hiring-activity"');
    assert.ok(secondaryIndex < intelIndex, "CompanyIntelligenceGrid moved ahead of the secondary wrapper");
    assert.ok(railIndex !== -1 && railIndex < hiringActivityIndex, "the hiring record must live in the rail");
    assert.ok(rolesIndex < railIndex, "the rail must come after the roles, so phones reach the roles first");
  });
});

// #421 (d254a782) dropped the fact-row icons: the rulebook says the facts
// row has no icons, so it is plain DotSeparated text.
describe("/co/[slug]: hero fact row is plain dot-separated facts, not a joined mono string", () => {
  it("renders the domain as a real link plus the hiring-geos and remote-share facts via buildCompanyFacts", () => {
    const source = readFileSync(CO_PAGE_BODY, "utf8");
    assert.match(source, /buildCompanyFacts\(/, "hero must read the structured facts, not the retired joined-line helper");
    assert.match(source, /href=\{`https:\/\/\$\{facts\.domain\}`\}/, "domain must render as a real external link");
    assert.match(source, /<DotSeparated/);
    assert.match(source, /facts\.hiringGeos/);
    assert.match(source, /facts\.remoteShare/);
  });

  it("carries no font-mono utility — the fact row is prose, not a tabular/aligned surface", () => {
    const source = readFileSync(CO_PAGE_BODY, "utf8");
    assert.doesNotMatch(source, /(?<![-\w])font-mono(?![-\w])/);
  });
});

describe("/co/[slug]: the rail — hiring record and list health, gated, no button", () => {
  it("a second, distinct CompanyIntelGate carries the rail's two named boxes", () => {
    const source = readFileSync(CO_PAGE_BODY, "utf8");
    const secondaryGateIndex = source.indexOf("<CompanyIntelGate", source.indexOf('data-testid="company-secondary"'));
    const railGateIndex = source.indexOf('testId="company-intel-gate-record"');
    const recordHeadingIndex = source.indexOf('data-testid="company-hiring-activity"');
    const listHealthIndex = source.indexOf("List health");
    assert.ok(railGateIndex !== -1, "rail gate with a distinct testId is missing");
    assert.ok(secondaryGateIndex < railGateIndex, "the rail gate must be a second, later gate instance");
    assert.ok(railGateIndex < recordHeadingIndex && railGateIndex < listHealthIndex, "both named boxes must live inside the rail gate");
  });

  // #554 (d3622138): the rail gate renders nothing when locked (fallback={null})
  // instead of a CTA-less second card, so the page shows exactly one lock card.
  it("the rail gate passes fallback={null} — no duplicate lock card beside the header's Follow control", () => {
    const source = readFileSync(CO_PAGE_BODY, "utf8");
    const railGate = source.slice(source.indexOf('testId="company-intel-gate-record"'));
    assert.match(railGate.slice(0, railGate.indexOf(">")), /fallback=\{null\}/);
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

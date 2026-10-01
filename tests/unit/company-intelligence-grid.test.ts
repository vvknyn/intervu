import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CompanyIntelligenceGrid } from "../../src/components/company/CompanyIntelligenceGrid";
import type { CompanyIntelligence } from "../../src/lib/companies/types";

/**
 * Guards artifact-spec item 6: the "How they work" remote/hybrid/onsite
 * progress-bar card is retired from `CompanyIntelligenceGrid` — that split
 * now lives in the /co hero's fact row (`buildCompanyFacts`,
 * lib/companies/presentation.ts) instead. Tech stack is the class-wide case
 * this guards against a regression of: `workModes` alone must no longer be
 * enough to (a) render a card or (b) even open the "Company details"
 * section, since a card that no longer exists can't be the reason the
 * section shows.
 */

function intel(overrides: Partial<CompanyIntelligence> = {}): CompanyIntelligence {
  return {
    funding: null,
    visa: null,
    techStack: null,
    workModes: null,
    news: [],
    ...overrides,
  };
}

function render(intelligence: CompanyIntelligence | null): string {
  return renderToStaticMarkup(
    React.createElement(CompanyIntelligenceGrid, { intelligence, companyName: "Acme" }),
  );
}

test("workModes alone no longer opens the section — the card it used to justify is gone", () => {
  const html = render(intel({ workModes: { remotePct: 40, hybridPct: 30, onsitePct: 30, remoteCount: 4, total: 10 } }));
  assert.equal(html, "");
});

test("a company with tech stack AND work-modes data renders only the tech-stack card — no 'How they work' bar", () => {
  const html = render(
    intel({
      techStack: { languages: ["TypeScript"], frameworks: [], infrastructure: [], aiMlTools: [] },
      workModes: { remotePct: 40, hybridPct: 30, onsitePct: 30, remoteCount: 4, total: 10 },
    }),
  );
  assert.match(html, /Languages and tools in their job posts/);
  assert.match(html, /TypeScript/);
  assert.doesNotMatch(html, /How they work/);
  assert.doesNotMatch(html, /remote,.*hybrid,.*on-site/);
});

// Funding only ever carried `company_stage` (enrichment.ts fills no amount,
// valuation or investors), which the header's facts row already shows, and
// visa sponsorship is counted in the public stat row. Neither opens the
// section on its own any more.
test("funding-only or visa-only intelligence renders nothing, since both are shown elsewhere", () => {
  assert.equal(render(intel({ funding: { totalRaisedText: null, stage: "Series B", valuationText: null, investors: [] } })), "");
  assert.equal(
    render(
      intel({
        visa: { h1bFilingsCount: null, approvalRatePct: null, sponsoredRolesRatioPct: 40, permSponsored: false, topSponsoredRoles: [] },
      }),
    ),
    "",
  );
});

test("news renders as flat link rows with a dated source line", () => {
  const html = render(
    intel({
      news: [
        {
          title: "Acme raises a Series C",
          url: "https://news.example/acme",
          summary: null,
          publisher: "News Example",
          published_at: "2026-08-15T12:00:00Z",
          is_funding_event: true,
          confidence: "high",
        },
      ],
    }),
  );
  assert.match(html, /Acme in the news/);
  assert.match(html, /href="https:\/\/news.example\/acme"/);
  assert.match(html, /News Example · Aug 15, 2026/);
  assert.doesNotMatch(html, /shadow-|<svg/);
});

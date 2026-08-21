import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CompanyIntelligenceGrid } from "../../src/components/company/CompanyIntelligenceGrid";
import type { CompanyIntelligence } from "../../src/lib/companies/types";

/**
 * Guards artifact-spec item 6: the "How they work" remote/hybrid/onsite
 * progress-bar card is retired from `CompanyIntelligenceGrid` — that split
 * now lives in the /co hero's facts line (`buildCompanyFactsLine`,
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
  const html = render(intel({ workModes: { remotePct: 40, hybridPct: 30, onsitePct: 30 } }));
  assert.equal(html, "");
});

test("a company with tech stack AND work-modes data renders only the tech-stack card — no 'How they work' bar", () => {
  const html = render(
    intel({
      techStack: { languages: ["TypeScript"], frameworks: [], infrastructure: [], aiMlTools: [] },
      workModes: { remotePct: 40, hybridPct: 30, onsitePct: 30 },
    }),
  );
  assert.match(html, /Tech stack/);
  assert.doesNotMatch(html, /How they work/);
  assert.doesNotMatch(html, /remote,.*hybrid,.*on-site/);
});

test("funding-only intelligence still opens the section (a case other than tech stack)", () => {
  const html = render(intel({ funding: { totalRaisedText: null, stage: "Series B", valuationText: null, investors: [] } }));
  assert.match(html, /Capital &amp; Stage/);
  assert.doesNotMatch(html, /How they work/);
});

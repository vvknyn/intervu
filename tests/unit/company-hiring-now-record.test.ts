import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CompanySections } from "@/components/company/CompanySections";
import { buildCompanyFacts } from "@/lib/companies/company-facts";
import type { CompanyExhaust } from "@/lib/companies/exhaust";
import type { PublicJob } from "@/lib/jobs/types";

const NOW = Date.parse("2026-10-24T00:00:00Z");

// Synthetic employer whose job documents carry a sync aggregate that disagrees with the integrity facts.
const synced = { id: "1", title: "Engineer", company: "Zed Corp", company_domain: "zed.example", vacancy_status: "open", company_opened_90d: 999, company_closed_90d: 888 } as unknown as PublicJob;

const facts = () =>
  buildCompanyFacts({ name: "Zed Corp", domain: "zed.example", jobs: [synced], openCount: { value: 4, isLowerBound: false }, postingTotal: 4 });

const withIntegrity = (openedCount: number, closed: number, trackedSinceIso: string | null) =>
  ({
    integrity: {
      data: { closedReasonCounts: [{ reason: "filled", label: "Filled", count: closed }], openedCount, trackedSinceIso },
      source: "job_listings",
      label: "Job listings",
      asOf: new Date(NOW).toISOString(),
    },
  }) as unknown as CompanyExhaust;

const hiringNow = (exhaust: CompanyExhaust | null) =>
  renderToStaticMarkup(
    React.createElement(CompanySections, {
      ids: ["hiringNow"],
      ctx: { facts: facts(), exhaust, nowMs: NOW, roles: null, related: null, faq: [], staleShare: null },
    }),
  );

describe("Hiring now states the opened/closed record from IntegrityFacts only", () => {
  it("tracked inside the window: names the start and excludes the first-week backlog", () => {
    const html = hiringNow(withIntegrity(31, 12, "2026-09-09T08:00:00Z"));
    assert.match(html, /Tracked since the week of Sep 7, 2026: 31 roles opened after that first week, 12 closed\./);
    assert.doesNotMatch(html, /last 13 weeks/i);
  });

  it("tracked before the window: states the full window", () => {
    const html = hiringNow(withIntegrity(52, 40, "2026-03-02T08:00:00Z"));
    assert.match(html, /Last 13 weeks: 52 roles opened, 40 closed\./);
    assert.doesNotMatch(html, /Tracked since/);
  });

  it("integrity facts missing: no opened/closed line, and the job-document aggregate is never shown", () => {
    const html = hiringNow(null);
    assert.doesNotMatch(html, /opened|closed/);
    assert.doesNotMatch(html, /999|888/);
    assert.match(html, /4 open roles/);
  });
});

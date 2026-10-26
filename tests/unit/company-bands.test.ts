import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CompanyCadenceStrip } from "@/components/company/CompanyCadenceStrip";
import { cadenceStripHasContent } from "@/lib/companies/hiring-record";
import { CompanyVerdictBand, verdictBandHasContent } from "@/components/company/CompanyVerdictBand";
import { buildWeeklyCadence, type CadenceFacts, type ExhaustSection, type HealthFacts } from "@/lib/companies/exhaust";

/**
 * The company page's public hiring bands. The posting chart draws only weeks
 * Velai watched and prints every count; the review band is evidence under
 * the header's answer, never a second answer or an undefined score.
 */

const NOW = Date.parse("2026-08-27T00:00:00Z");

function cadence(trackedSinceIso: string | null, sums: { weekStartIso: string; newListings: number }[]): ExhaustSection<CadenceFacts> {
  return {
    data: { weeks: buildWeeklyCadence(sums, NOW, 26, trackedSinceIso) },
    source: "job_listings",
    label: "Posting activity",
    asOf: new Date(NOW).toISOString(),
  };
}

const strip = (c: ExhaustSection<CadenceFacts>) => renderToStaticMarkup(React.createElement(CompanyCadenceStrip, { cadence: c }));

describe("CompanyCadenceStrip", () => {
  it("starts at the first tracked week, labels it, and prints the counts", () => {
    const html = strip(
      cadence("2026-08-05", [
        { weekStartIso: "2026-08-03", newListings: 40 },
        { weekStartIso: "2026-08-17", newListings: 3 },
      ]),
    );
    assert.equal(html.match(/data-testid="company-cadence-week"/g)?.length, 4);
    assert.doesNotMatch(html, /tracking since/, "the sentence above states the start; the chart does not repeat it");
    assert.match(html, /First week tracked: includes roles already open/);
    assert.match(html, />40</);
    assert.match(html, />3</);
    assert.match(html, /This week so far/);
  });

  it("keeps the backlog week out of the scale, so a normal week is not flattened", () => {
    const html = strip(
      cadence("2026-08-05", [
        { weekStartIso: "2026-08-03", newListings: 40 },
        { weekStartIso: "2026-08-17", newListings: 3 },
      ]),
    );
    // The 3-posting week is the tallest scaled week, so it takes the full height.
    assert.match(html, /title="3 new postings, week of Aug 17, 2026"[^>]*>[\s\S]*?h-16 bg-brand/);
  });

  it("says 'last 26 weeks' with no first-week legend when tracking began before the window", () => {
    const html = strip(cadence("2025-01-06", [{ weekStartIso: "2026-08-17", newListings: 2 }]));
    assert.equal(html.match(/data-testid="company-cadence-week"/g)?.length, 26);
    assert.match(html, /last 26 weeks/);
    assert.doesNotMatch(html, /First week tracked/);
  });

  it("sizes bars with classes, never an inline style", () => {
    assert.doesNotMatch(strip(cadence(null, [{ weekStartIso: "2026-08-17", newListings: 5 }])), /style=/);
  });
});

function health(overrides: Partial<HealthFacts>): ExhaustSection<HealthFacts> {
  return {
    data: {
      verdict: "actively_hiring",
      score: 88,
      repostRate: null,
      operatingStatus: "active",
      observedSinceIso: "2026-01-01T00:00:00Z",
      ...overrides,
    },
    source: "company_health_reviews",
    label: "Company health review",
    asOf: "2026-08-22T00:00:00Z",
  };
}

const band = (h: ExhaustSection<HealthFacts>) =>
  renderToStaticMarkup(React.createElement(CompanyVerdictBand, { health: h, nowMs: NOW }));

describe("CompanyVerdictBand", () => {
  it("states the review as a dated line, with no health score and no 'Active' status", () => {
    const html = band(health({ repostRate: 0.08 }));
    assert.doesNotMatch(html, /Are they actually hiring\?/);
    assert.match(html, /Velai(&#x27;|')s review on Aug 22, 2026: actively hiring\./);
    assert.doesNotMatch(html, /health score|>88</);
    assert.doesNotMatch(html, /operating status/);
    assert.match(html, />8%</);
  });

  it("shows an unusual operating status", () => {
    assert.match(band(health({ operatingStatus: "acquired" })), /Acquired[\s\S]*operating status/);
  });

  it("renders nothing when the review has no verdict it can stand behind, no repost rate and a usual status", () => {
    assert.equal(band(health({ observedSinceIso: "2026-08-20T00:00:00Z" })), "");
  });
});

describe("rail layout predicates", () => {
  it("agree with what each band renders, so the page never reserves a column for nothing", () => {
    const cases: [ExhaustSection<HealthFacts>, boolean][] = [
      [health({ repostRate: 0.08 }), true],
      [health({ operatingStatus: "acquired" }), true],
      [health({ observedSinceIso: "2026-08-20T00:00:00Z" }), false],
      [null, false],
    ];
    for (const [h, expected] of cases) {
      assert.equal(verdictBandHasContent(h, NOW), expected);
      assert.equal(h ? band(h) !== "" : false, expected);
    }
    const withWeeks = cadence(null, [{ weekStartIso: "2026-08-17", newListings: 5 }]);
    assert.equal(cadenceStripHasContent(withWeeks), true);
    assert.notEqual(strip(withWeeks), "");
    assert.equal(cadenceStripHasContent(null), false);
  });
});

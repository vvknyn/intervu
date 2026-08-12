import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCompanyHiringAnswer } from "@/lib/companies/presentation";
import type { CompanyPageData } from "@/lib/companies/types";
import { buildCompanyFaqItems } from "@/lib/seo/jsonld";

function company(overrides: Partial<CompanyPageData> = {}): CompanyPageData {
  return {
    domain: "lumentum.com",
    slug: "lumentum--com",
    name: "Lumentum",
    nameSource: "corpus-cased",
    oneLiner: null,
    stage: null,
    opened90d: null,
    closed90d: null,
    hasTrackRecord: false,
    openCount: 213,
    openCountIsLowerBound: false,
    ghostFlaggedPct: null,
    jobs: [],
    boards: ["elite"],
    ...overrides,
  };
}

describe("companies/presentation — the answer to 'Is X hiring?'", () => {
  it("answers from the open-role count when the 90-day aggregates are absent (every employer today)", () => {
    const answer = buildCompanyHiringAnswer(company());
    assert.equal(answer.hasOpenRoles, true);
    assert.equal(answer.headline, "Yes — 213 open roles are live on intervu right now.");
    // The half it does NOT have is stated as missing, not implied, not
    // rendered as a plausible-looking zero or an em-dash on its own.
    assert.equal(
      answer.trackRecord,
      "Opened and closed counts for the last 90 days aren't tracked for this employer yet.",
    );
    // No count of any kind is asserted about the window it cannot see.
    assert.doesNotMatch(answer.trackRecord, /\d+ roles? (opened|closed)/);
  });

  it("gets richer from the same code once the aggregates arrive — no edit required", () => {
    const answer = buildCompanyHiringAnswer(
      company({ opened90d: 48, closed90d: 31, hasTrackRecord: true }),
    );
    assert.equal(answer.headline, "Yes — 213 open roles are live on intervu right now.");
    assert.equal(answer.trackRecord, "Last 90 days: 48 roles opened, 31 closed.");
  });

  it("keeps a floor a floor and singularises one role", () => {
    assert.equal(
      buildCompanyHiringAnswer(company({ openCount: 200, openCountIsLowerBound: true })).headline,
      "Yes — 200+ open roles are live on intervu right now.",
    );
    assert.equal(
      buildCompanyHiringAnswer(company({ openCount: 1 })).headline,
      "Yes — 1 open role is live on intervu right now.",
    );
  });

  it("reports what intervu tracks rather than answering 'no' about the world", () => {
    const answer = buildCompanyHiringAnswer(company({ openCount: 0 }));
    assert.equal(answer.hasOpenRoles, false);
    assert.equal(answer.headline, "intervu isn't tracking any live open roles right now.");
    assert.doesNotMatch(answer.headline, /^(Yes|No)\b/);
    // A zero-role employer still gets the 90-day record when one exists.
    assert.equal(
      buildCompanyHiringAnswer(
        company({ openCount: 0, opened90d: 0, closed90d: 12, hasTrackRecord: true }),
      ).trackRecord,
      "Last 90 days: 0 roles opened, 12 closed.",
    );
  });

  it("hands the FAQPage structured data the exact sentence the body renders", () => {
    const answer = buildCompanyHiringAnswer(company());
    const items = buildCompanyFaqItems({
      companyName: "Lumentum",
      hiringAnswer: answer.headline,
      ghostFlaggedPct: null,
    });
    assert.equal(items[0]!.question, "Is Lumentum hiring?");
    assert.equal(items[0]!.answer, answer.headline);
  });
});

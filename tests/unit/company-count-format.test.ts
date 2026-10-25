import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { hiringRecordSentence } from "@/lib/companies/hiring-record";
import { buildWarnSentence, type IntegrityFacts, type WarnNoticeFacts } from "@/lib/companies/exhaust";
import { CompanyCadenceStrip } from "@/components/company/CompanyCadenceStrip";

const NOW = Date.parse("2026-10-24T00:00:00Z");
const facts = (openedCount: number, closed: number, trackedSinceIso: string | null) =>
  ({ closedReasonCounts: [{ reason: "filled", label: "Filled", count: closed }], openedCount, trackedSinceIso }) as unknown as IntegrityFacts;

describe("company counts use thousands separators", () => {
  it("full-window record sentence at amazon scale", () => {
    assert.equal(hiringRecordSentence(facts(34255, 36752, "2026-02-02T08:00:00Z"), NOW), "Last 13 weeks: 34,255 roles opened, 36,752 closed.");
  });
  it("tracked-since variant", () => {
    assert.equal(
      hiringRecordSentence(facts(12345, 1000, "2026-09-30T08:00:00Z"), NOW),
      "Tracked since the week of Sep 28, 2026: 12,345 roles opened after that first week, 1,000 closed.",
    );
  });
  it("numbers under 1000 are unchanged", () => {
    assert.equal(hiringRecordSentence(facts(1, 999, "2026-02-02T08:00:00Z"), NOW), "Last 13 weeks: 1 role opened, 999 closed.");
  });
  it("a surface other than the record sentence: weekly chart labels and the layoff sentence", () => {
    const week = (weekStartIso: string, newListings: number) => ({ weekStartIso, newListings, inProgress: false, firstTracked: false });
    const html = renderToStaticMarkup(
      createElement(CompanyCadenceStrip, { cadence: { data: { weeks: [week("2026-10-12", 2894), week("2026-10-19", 12)] } } } as never),
    );
    assert.match(html, />2,894</);
    assert.match(html, /2,894 new postings/);
    assert.match(html, />12</);
    assert.equal(
      buildWarnSentence({ noticeCount: 1, totalEmployeesAffected: 4200 } as WarnNoticeFacts),
      "1 layoff notice filed — 4,200 employees affected.",
    );
  });
});

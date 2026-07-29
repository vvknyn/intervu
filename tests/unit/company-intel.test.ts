import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatCompanyIntel } from "@/lib/jobs/company-intel";

const base = { company_stage: null, company_opened_90d: null, company_closed_90d: null, company_open_count: null };

describe("formatCompanyIntel", () => {
  it("returns null when no observations", () => {
    assert.equal(formatCompanyIntel(base as any), null);
  });
  it("does not invent zeros for missing opened/closed", () => {
    assert.equal(formatCompanyIntel({ ...base, company_open_count: 18 } as any), "18 open roles");
  });
  it("formats full strip when counts present", () => {
    const s = formatCompanyIntel({
      company_stage: "Early-stage",
      company_opened_90d: 14,
      company_closed_90d: 3,
      company_open_count: 18,
    } as any);
    assert.equal(s, "Early-stage · Opened 14 / closed 3 in 90d · 18 open roles");
  });
});

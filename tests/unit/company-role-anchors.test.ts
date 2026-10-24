import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const src = readFileSync("src/components/company/CompanyRoleSearch.tsx", "utf8");

describe("company role list is crawlable", () => {
  it("renders every matched role (not the preview slice) as an anchor to its job page", () => {
    assert.match(src, /\{matched\.map\(\(job, index\) =>/);
    assert.match(src, /<a\s+href=\{jobPath\(job\)\}\s+data-testid="company-role-row"/);
    assert.doesNotMatch(src, /<button[^>]*data-testid="company-role-row"/);
  });
  it("collapses rows past the preview visually with `hidden`, never by dropping them", () => {
    assert.match(src, /<li key=\{job\.id\} hidden=\{index >= visibleCount\}>/);
  });
  it("puts the conversion band above the role list, once", () => {
    assert.equal((src.match(/Explore all open roles at/g) ?? []).length, 1);
    assert.ok(src.indexOf("Explore all open roles at") < src.indexOf("<SectionTitle"));
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Locks the `/co/[slug]` visual-density contract — app-surface rhythm (16–32px),
 * not the airy marketing spacing the 2026 redesign accidentally carried over.
 */
const CO_PAGE = readFileSync(join(__dirname, "..", "..", "src", "app", "co", "[slug]", "page.tsx"), "utf8");
const CO_LOADING = readFileSync(join(__dirname, "..", "..", "src", "app", "co", "[slug]", "loading.tsx"), "utf8");
const ROLE_SEARCH = readFileSync(join(__dirname, "..", "..", "src", "components", "company", "CompanyRoleSearch.tsx"), "utf8");

const BAND_FILES = [
  "src/components/company/CompanyVerdictBand.tsx",
  "src/components/company/CompanyCadenceStrip.tsx",
  "src/components/company/CompanyFactRow.tsx",
  "src/components/company/CompanyIntegrityBand.tsx",
  "src/components/company/CompanyTechStackBand.tsx",
  "src/components/company/CompanyFilingsBand.tsx",
] as const;

describe("company page density contract", () => {
  it("page frame uses tight app gutters, not marketing py-8 / pb-16", () => {
    assert.match(CO_PAGE, /px-4 py-4 pb-8 sm:px-8 sm:pb-10 xl:px-10/);
    assert.doesNotMatch(CO_PAGE, /\bpy-8\b/);
    assert.doesNotMatch(CO_PAGE, /\bpb-16\b/);
  });

  it("hero h1 is text-xl sm:text-2xl, not text-3xl", () => {
    assert.match(CO_PAGE, /text-xl font-semibold sm:text-2xl/);
    assert.doesNotMatch(CO_PAGE, /\btext-3xl\b/);
  });

  it("CompanyRoleSearch rows are hairline-separated SERP density, not card stacks with View role", () => {
    assert.match(ROLE_SEARCH, /divide-y divide-border border-t border-border/);
    assert.match(ROLE_SEARCH, /CompanyJobRowButton/);
    assert.doesNotMatch(ROLE_SEARCH, /View role/);
    assert.doesNotMatch(ROLE_SEARCH, /\bpy-4\b.*text-base font-semibold/);
    assert.match(ROLE_SEARCH, /size="sm"/, "footer CTA stays compact");
    assert.doesNotMatch(ROLE_SEARCH, /\bp-6\b/);
  });

  it("shared company bands are not padded px-6 py-6 sm:px-8", () => {
    for (const file of BAND_FILES) {
      const src = readFileSync(join(__dirname, "..", "..", file), "utf8");
      assert.doesNotMatch(
        src,
        /px-6 py-6 sm:px-8/,
        `${file} must not use the retired airy band padding`,
      );
    }
  });

  it("loading breadcrumb matches the live page nav chrome", () => {
    assert.match(CO_LOADING, /flex h-10 max-w-6xl items-center text-sm/);
    assert.doesNotMatch(CO_LOADING, /border-b border-border bg-card/);
  });
});

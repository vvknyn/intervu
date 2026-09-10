import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { LEGAL_LINKS } from "@/components/layout/Footer";
import { COMPARISON_ROWS } from "@/lib/seo/board-comparison";
import {
  INDEED_ALTERNATIVE,
  INDEED_ALTERNATIVE_FAQ,
  LINKEDIN_JOBS_ALTERNATIVE,
  LINKEDIN_JOBS_ALTERNATIVE_FAQ,
} from "@/lib/seo/alternatives";
import { buildFaqPageJsonLd } from "@/lib/seo/jsonld";

const ROOT = join(__dirname, "..", "..");

describe("competitor-alternative pages", () => {
  it("footer and sitemap both name the two URLs", () => {
    const hrefs = LEGAL_LINKS.map((l) => l.href);
    assert.ok(hrefs.includes(INDEED_ALTERNATIVE.path));
    assert.ok(hrefs.includes(LINKEDIN_JOBS_ALTERNATIVE.path));
    const sitemapSrc = readFileSync(join(ROOT, "src/app/sitemap.ts"), "utf8");
    assert.ok(sitemapSrc.includes("`/indeed-alternative`") || sitemapSrc.includes("/indeed-alternative"));
    assert.ok(sitemapSrc.includes("/linkedin-jobs-alternative"));
  });

  it("about reuses the shared comparison table and points at both pages", () => {
    const about = readFileSync(join(ROOT, "src/app/about/page.tsx"), "utf8");
    assert.match(about, /BoardComparisonTable/);
    assert.match(about, /board="typical"/);
    assert.match(about, /href="\/indeed-alternative"/);
    assert.match(about, /href="\/linkedin-jobs-alternative"/);
  });

  it("titles target the queries people actually type", () => {
    assert.match(INDEED_ALTERNATIVE.title, /Indeed alternative/i);
    assert.match(LINKEDIN_JOBS_ALTERNATIVE.title, /LinkedIn Jobs alternative/i);
    assert.notEqual(INDEED_ALTERNATIVE.title, LINKEDIN_JOBS_ALTERNATIVE.title);
  });

  it("FAQ graphs are non-empty and unequal (pages are not clones)", () => {
    assert.equal(INDEED_ALTERNATIVE_FAQ.length, 4);
    assert.equal(LINKEDIN_JOBS_ALTERNATIVE_FAQ.length, 2);
    const indeedGraph = buildFaqPageJsonLd(INDEED_ALTERNATIVE_FAQ);
    const linkedinGraph = buildFaqPageJsonLd(LINKEDIN_JOBS_ALTERNATIVE_FAQ);
    assert.ok(indeedGraph);
    assert.ok(linkedinGraph);
    assert.notEqual(JSON.stringify(indeedGraph), JSON.stringify(linkedinGraph));
  });

  it("comparison table has one velai column shared across boards", () => {
    assert.equal(COMPARISON_ROWS.length, 4);
    for (const row of COMPARISON_ROWS) {
      assert.ok(row.velai.length > 0);
      assert.ok(row.indeed.length > 0);
      assert.ok(row.linkedin.length > 0);
      assert.ok(row.typical.length > 0);
    }
  });

  it("page bodies are different arguments, not a swapped heading", () => {
    const indeed = readFileSync(join(ROOT, "src/app/indeed-alternative/page.tsx"), "utf8");
    const linkedin = readFileSync(join(ROOT, "src/app/linkedin-jobs-alternative/page.tsx"), "utf8");
    assert.match(indeed, /The listing is still up/);
    assert.match(linkedin, /Easy Apply is a feeling/);
    assert.match(indeed, /BoardComparisonTable board="indeed"/);
    assert.match(linkedin, /BoardComparisonTable board="linkedin"/);
    assert.ok(!indeed.includes("Easy Apply is a feeling"));
    assert.ok(!linkedin.includes("The listing is still up"));
  });
});

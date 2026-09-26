import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { LEGAL_LINKS } from "@/components/layout/Footer";
import { COMPARISON_ROWS } from "@/lib/seo/board-comparison";
import {
  ELUTA_ALTERNATIVE,
  ELUTA_ALTERNATIVE_FAQ,
  INDEED_ALTERNATIVE,
  INDEED_ALTERNATIVE_FAQ,
  LINKEDIN_JOBS_ALTERNATIVE,
  LINKEDIN_JOBS_ALTERNATIVE_FAQ,
} from "@/lib/seo/alternatives";
import { buildFaqPageJsonLd } from "@/lib/seo/jsonld";

const ROOT = join(__dirname, "..", "..");

describe("competitor-alternative pages", () => {
  it("footer and sitemap name all three alternative URLs", () => {
    const hrefs = LEGAL_LINKS.map((l) => l.href);
    assert.ok(hrefs.includes(INDEED_ALTERNATIVE.path));
    assert.ok(hrefs.includes(LINKEDIN_JOBS_ALTERNATIVE.path));
    assert.ok(hrefs.includes(ELUTA_ALTERNATIVE.path));
    assert.ok(!hrefs.includes("/careers/canada-jobs"));
    const sitemapSrc = readFileSync(join(ROOT, "src/app/sitemap.ts"), "utf8");
    assert.ok(sitemapSrc.includes("`/indeed-alternative`") || sitemapSrc.includes("/indeed-alternative"));
    assert.ok(sitemapSrc.includes("/linkedin-jobs-alternative"));
    assert.ok(sitemapSrc.includes("/eluta-alternative"));
  });

  it("about reuses the shared comparison table and points at all alternative pages", () => {
    const about = readFileSync(join(ROOT, "src/app/about/page.tsx"), "utf8");
    assert.match(about, /BoardComparisonTable/);
    assert.match(about, /board="typical"/);
    assert.match(about, /href="\/indeed-alternative"/);
    assert.match(about, /href="\/linkedin-jobs-alternative"/);
    assert.match(about, /href="\/eluta-alternative"/);
    assert.doesNotMatch(about, /href="\/careers\/canada-jobs"/);
  });

  it("titles target the queries people actually type", () => {
    assert.match(INDEED_ALTERNATIVE.title, /Indeed alternative/i);
    assert.match(LINKEDIN_JOBS_ALTERNATIVE.title, /LinkedIn Jobs alternative/i);
    assert.match(ELUTA_ALTERNATIVE.title, /Eluta alternative/i);
    assert.notEqual(INDEED_ALTERNATIVE.title, LINKEDIN_JOBS_ALTERNATIVE.title);
    assert.notEqual(ELUTA_ALTERNATIVE.title, INDEED_ALTERNATIVE.title);
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
    const eluta = readFileSync(join(ROOT, "src/app/eluta-alternative/page.tsx"), "utf8");
    assert.match(indeed, /The listing is still up/);
    assert.match(linkedin, /Easy Apply is a feeling/);
    assert.match(eluta, /Eluta crawls the career page/);
    assert.match(indeed, /BoardComparisonTable board="indeed"/);
    assert.match(linkedin, /BoardComparisonTable board="linkedin"/);
    assert.match(eluta, /BoardComparisonTable board="typical"/);
    assert.ok(!indeed.includes("Easy Apply is a feeling"));
    assert.ok(!linkedin.includes("The listing is still up"));
    assert.ok(!eluta.includes("The listing is still up"));
  });

  it("Eluta FAQ graph is non-empty and distinct from Indeed", () => {
    assert.equal(ELUTA_ALTERNATIVE_FAQ.length, 3);
    const elutaGraph = buildFaqPageJsonLd(ELUTA_ALTERNATIVE_FAQ);
    const indeedGraph = buildFaqPageJsonLd(INDEED_ALTERNATIVE_FAQ);
    assert.ok(elutaGraph);
    assert.notEqual(JSON.stringify(elutaGraph), JSON.stringify(indeedGraph));
  });
});

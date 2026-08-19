process.env.NEXT_PUBLIC_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://intervuhq.com";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildArticleJsonLd,
  buildCompanyFaqItems,
  buildCompanyOrganizationJsonLd,
  buildFaqPageJsonLd,
  buildJobSearchFaqJsonLd,
  buildWebApplicationJsonLd,
  buildWebsiteJsonLd,
  serializeJsonLd,
} from "@/lib/seo/jsonld";
import { getSiteUrl } from "@/lib/seo/constants";
import { companyLogoUrl } from "@/lib/companies/logo";

// Absolute URLs are asserted against `getSiteUrl()`, never a literal host.
// These assertions previously pinned https://intervu.cc — the domain the site
// MOVED OFF on 2026-08-08 — so they passed only when the run happened to set
// the retired host, and would have failed against production. Deriving the
// origin tests the behaviour (origin + path) instead of the deployment.
const ORIGIN = getSiteUrl();

describe("seo/jsonld", () => {
  it("buildCompanyFaqItems publishes the page's own hiring answer verbatim", () => {
    // The answer is authored once, by `buildCompanyHiringAnswer`, and rendered
    // in the page body; this builder must not restate it in words of its own,
    // or the structured data starts asserting something no reader can see.
    const items = buildCompanyFaqItems({
      companyName: "Acme",
      hiringAnswer: "intervu isn't tracking any live open roles right now.",
      ghostFlaggedPct: null,
    });
    assert.equal(items.length, 1);
    assert.equal(items[0]!.question, "Is Acme hiring?");
    assert.equal(items[0]!.answer, "intervu isn't tracking any live open roles right now.");
  });

  it("buildCompanyFaqItems adds the ghost question when a pct exists", () => {
    const items = buildCompanyFaqItems({
      companyName: "Beta",
      hiringAnswer: "Yes — 1 open role is live on intervu right now.",
      ghostFlaggedPct: 25,
    });
    assert.equal(items.length, 2);
    assert.match(items[0]!.answer, /1 open role is live/);
    assert.equal(items[1]!.question, "Does Beta have ghost-job risk?");
    assert.match(items[1]!.answer, /25% of Beta's tracked postings/);
  });

  it("buildCompanyFaqItems skips the ghost question when ghostFlaggedPct is null (no scored postings)", () => {
    const items = buildCompanyFaqItems({
      companyName: "Gamma",
      hiringAnswer: "Yes — 4 open roles are live on intervu right now.",
      ghostFlaggedPct: null,
    });
    assert.equal(items.length, 1);
    assert.ok(!items.some((i) => i.question.includes("ghost-job risk")));
  });

  it("buildFaqPageJsonLd drops blank pairs and returns null when nothing valid remains", () => {
    assert.equal(buildFaqPageJsonLd([{ question: "  ", answer: "" }]), null);
    assert.equal(buildFaqPageJsonLd([]), null);

    const jsonLd = buildFaqPageJsonLd([
      { question: "Q1", answer: "A1" },
      { question: "  ", answer: "dropped" },
    ]);
    assert.ok(jsonLd);
    assert.equal(jsonLd!["@type"], "FAQPage");
    assert.equal(jsonLd!.mainEntity.length, 1);
    assert.equal(jsonLd!.mainEntity[0]!.name, "Q1");
    assert.equal(jsonLd!.mainEntity[0]!.acceptedAnswer.text, "A1");
  });

  it("buildJobSearchFaqJsonLd includes questions comparing Intervu to Indeed and LinkedIn", () => {
    const jsonLd = buildJobSearchFaqJsonLd();
    assert.ok(jsonLd);
    assert.equal(jsonLd["@type"], "FAQPage");
    assert.ok(jsonLd.mainEntity.some((q) => q.name.includes("Indeed and LinkedIn")));
    assert.ok(jsonLd.mainEntity.some((q) => q.name.includes("ghost job")));
  });

  it("buildWebApplicationJsonLd emits WebApplication graph", () => {
    const jsonLd = buildWebApplicationJsonLd();
    assert.equal(jsonLd["@type"], "WebApplication");
    assert.equal(jsonLd.name, "Intervu Job Search");
    assert.equal(jsonLd.url, ORIGIN);
    assert.ok(jsonLd.featureList.length > 0);
  });

  it("buildArticleJsonLd defaults dateModified to datePublished and omits description when absent", () => {
    const jsonLd = buildArticleJsonLd({
      headline: "Ghost jobs aren't the problem",
      datePublished: "2026-07-01",
      path: "/research/ghost-jobs",
    });
    assert.equal(jsonLd.dateModified, "2026-07-01");
    assert.equal(jsonLd.url, `${ORIGIN}/research/ghost-jobs`);
    assert.equal(jsonLd.publisher.name, "Intervu");
    assert.equal("description" in jsonLd, false);
  });

  it("buildArticleJsonLd carries an explicit dateModified and description through untouched", () => {
    const jsonLd = buildArticleJsonLd({
      headline: "Headline",
      datePublished: "2026-07-01",
      dateModified: "2026-08-01",
      description: "A description.",
      path: "/research/ghost-jobs",
    });
    assert.equal(jsonLd.dateModified, "2026-08-01");
    assert.equal(jsonLd.description, "A description.");
  });

  it("buildWebsiteJsonLd points its SearchAction at the jobs search root", () => {
    const jsonLd = buildWebsiteJsonLd();
    assert.equal(jsonLd.potentialAction.target, `${ORIGIN}/jobs?q={search_term_string}`);
    assert.equal(jsonLd.potentialAction["query-input"], "required name=search_term_string");
    assert.ok(Array.isArray(jsonLd.alternateName));
  });

  it("buildCompanyOrganizationJsonLd builds a well-formed per-employer Organization graph", () => {
    const jsonLd = buildCompanyOrganizationJsonLd({ name: "ServiceTitan", domain: "servicetitan.com" });
    assert.equal(jsonLd["@context"], "https://schema.org");
    assert.equal(jsonLd["@type"], "Organization");
    assert.equal(jsonLd.name, "ServiceTitan");
    assert.equal(jsonLd.url, "https://servicetitan.com");
    // Same URL the CompanyLogo <img> tag renders — not a second, independently
    // invented logo source (see lib/companies/logo.ts).
    assert.equal(jsonLd.logo, companyLogoUrl("servicetitan.com"));
  });

  it("buildCompanyOrganizationJsonLd carries the name through verbatim — it does not re-clean it", () => {
    // Cleaning is `displayCompanyName`'s job (lib/jobs/presentation.ts), done
    // once by the caller, so the H1 and the structured data can't disagree.
    const jsonLd = buildCompanyOrganizationJsonLd({ name: "Not Pre-Cleaned, Inc.", domain: "acme.com" });
    assert.equal(jsonLd.name, "Not Pre-Cleaned, Inc.");
  });

  it("serializeJsonLd escapes '<' so a </script> in a value can't break out of the script tag", () => {
    const raw = serializeJsonLd({ text: "</script><script>alert(1)</script>" });
    assert.ok(!raw.includes("</script>"));
    assert.ok(raw.includes("\\u003c/script>"));
    // Still valid JSON once unescaped (i.e. we only escaped '<', never broke
    // the JSON structure itself).
    assert.deepEqual(JSON.parse(raw.replace(/\\u003c/g, "<")), {
      text: "</script><script>alert(1)</script>",
    });
  });
});


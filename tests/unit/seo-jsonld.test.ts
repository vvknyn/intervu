import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildArticleJsonLd,
  buildCompanyFaqItems,
  buildFaqPageJsonLd,
  buildWebsiteJsonLd,
  serializeJsonLd,
} from "@/lib/seo/jsonld";

describe("seo/jsonld", () => {
  it("buildCompanyFaqItems answers 'is X hiring?' even at zero open roles", () => {
    const items = buildCompanyFaqItems({ companyName: "Acme", openCount: 0, ghostFlaggedPct: null });
    assert.equal(items.length, 1);
    assert.equal(items[0]!.question, "Is Acme hiring?");
    assert.match(items[0]!.answer, /isn't tracking any live open roles/);
  });

  it("buildCompanyFaqItems singularizes 'role' at exactly 1 and adds the ghost question when a pct exists", () => {
    const items = buildCompanyFaqItems({ companyName: "Beta", openCount: 1, ghostFlaggedPct: 25 });
    assert.equal(items.length, 2);
    assert.match(items[0]!.answer, /1 live, verified open role at Beta/);
    assert.equal(items[1]!.question, "Does Beta have ghost-job risk?");
    assert.match(items[1]!.answer, /25% of Beta's tracked postings/);
  });

  it("buildCompanyFaqItems skips the ghost question when ghostFlaggedPct is null (no scored postings)", () => {
    const items = buildCompanyFaqItems({ companyName: "Gamma", openCount: 4, ghostFlaggedPct: null });
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

  it("buildArticleJsonLd defaults dateModified to datePublished and omits description when absent", () => {
    const jsonLd = buildArticleJsonLd({
      headline: "Ghost jobs aren't the problem",
      datePublished: "2026-07-01",
      path: "/research/ghost-jobs",
    });
    assert.equal(jsonLd.dateModified, "2026-07-01");
    assert.equal(jsonLd.url, "https://intervu.cc/research/ghost-jobs");
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
    assert.equal(jsonLd.potentialAction.target, "https://intervu.cc/?q={search_term_string}");
    assert.equal(jsonLd.potentialAction["query-input"], "required name=search_term_string");
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

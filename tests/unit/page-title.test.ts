import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonicalMetadata, pageTitle, TITLE_BUDGET } from "@/lib/seo/page-metadata";

describe("pageTitle", () => {
  it("appends the brand exactly once", () => {
    assert.equal(pageTitle("Contact"), "Contact · Velai");
    assert.equal(pageTitle("Privacy Policy"), "Privacy Policy · Velai");
  });

  it("leaves a title that already names the brand alone", () => {
    assert.equal(pageTitle("Velai — Indeed alternative that reads the career page"), "Velai — Indeed alternative that reads the career page");
    assert.equal(pageTitle("About velai"), "About velai");
  });

  it("joins parts and drops blank ones", () => {
    assert.equal(pageTitle("Nurse at Acme", null, "Austin, TX"), "Nurse at Acme — Austin, TX · Velai");
    assert.equal(pageTitle("  ", "Pricing", false), "Pricing · Velai");
  });

  it("drops trailing parts, never the first, to stay inside the budget", () => {
    const first = "Senior Software Engineer at Acme";
    const title = pageTitle(first, "Greater Metropolitan Area of Somewhere, Region, Country");
    assert.equal(title, `${first} · Velai`);
    assert.ok(title.length <= TITLE_BUDGET);
    const tail = pageTitle("Nurse at Acme", "Austin, TX");
    assert.equal(tail, "Nurse at Acme — Austin, TX · Velai");
  });

  it("keeps a first part that is longer than the budget whole", () => {
    const long = "Is a Very Long Named Company Incorporated hiring? Live verified jobs & ghost-job risk";
    assert.equal(pageTitle(long), `${long} · Velai`);
  });

  it("falls back to the brand when there are no parts", () => {
    assert.equal(pageTitle(), "Velai");
    assert.equal(pageTitle("", null, undefined), "Velai");
  });
});

describe("canonicalMetadata titles", () => {
  it("one branded title feeds <title>, og:title and twitter:title", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://velai.example";
    const m = canonicalMetadata("/contact", "Contact", "d");
    assert.deepEqual(m.title, { absolute: "Contact · Velai" });
    assert.equal(m.openGraph?.title, "Contact · Velai");
    assert.equal(m.twitter?.title, "Contact · Velai");
  });

  it("does not double the brand for a title that carries it", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://velai.example";
    const m = canonicalMetadata("/blog", "Velai blog", "d");
    assert.deepEqual(m.title, { absolute: "Velai blog" });
  });
});

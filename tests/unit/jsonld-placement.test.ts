process.env.NEXT_PUBLIC_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://intervuhq.com";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildSiteJsonLd } from "@/lib/seo/jsonld";
import * as jsonld from "@/lib/seo/jsonld";

const ROOT = join(__dirname, "..", "..");
const types = (html: string) => [...html.matchAll(/"@type":"([A-Za-z]+)"/g)].map((m) => m[1]);

const page = async (path: string) => (await import(path)).default;

describe("JSON-LD placement", () => {
  it("site graphs are WebSite + Organization only, with a logo and no unsourced sameAs", () => {
    const graphs = buildSiteJsonLd();
    assert.deepEqual(graphs.map((g) => g["@type"]), ["WebSite", "Organization"]);
    const org = graphs[1] as unknown as Record<string, unknown>;
    assert.match(String(org.logo), /\/icon-512\.png$/);
    assert.equal("sameAs" in org, false);
  });

  it("the root layout emits the site graphs and nothing page-specific", () => {
    const src = readFileSync(join(ROOT, "src/app/layout.tsx"), "utf8");
    assert.match(src, /buildSiteJsonLd\(\)/);
    assert.doesNotMatch(src, /buildJobSearchFaqJsonLd|buildWebApplicationJsonLd/);
  });

  it("the page that renders the FAQ carries FAQPage and WebApplication", async () => {
    const html = renderToStaticMarkup(React.createElement(await page("@/app/about/page")));
    assert.ok(types(html).includes("FAQPage"));
    assert.ok(types(html).includes("WebApplication"));
    assert.ok(html.includes("How is Velai different from Indeed and LinkedIn?"));
  });

  it("a page that renders no FAQ carries none", async () => {
    const html = renderToStaticMarkup(React.createElement(await page("@/app/contact/page")));
    assert.ok(!types(html).includes("FAQPage"));
    assert.ok(!types(html).includes("WebApplication"));
  });

  it("job posting markup is gone (job pages are noindex)", () => {
    assert.equal("buildJobPostingJsonLd" in jsonld, false);
  });
});

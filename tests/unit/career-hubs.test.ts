import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  CAREER_HUBS,
  careerHubJobsHref,
  getAllCareerHubSlugs,
  getCareerHub,
} from "@/lib/seo/career-hubs";

const ROOT = join(__dirname, "..", "..");

describe("career intent hubs", () => {
  it("registers every suggested slug once", () => {
    const expected = [
      "remote-jobs",
      "work-from-home-jobs",
      "software-engineer-jobs",
      "data-scientist-jobs",
      "nursing-jobs",
      "healthcare-jobs",
      "skilled-trades-jobs",
      "tech-jobs",
      "entry-level-jobs",
      "open-positions",
      "company-career-pages",
    ];
    assert.deepEqual(getAllCareerHubSlugs().sort(), expected.sort());
    assert.equal(CAREER_HUBS.length, expected.length);
  });

  it("each hub has unique copy and at least two related hubs", () => {
    const titles = new Set<string>();
    for (const hub of CAREER_HUBS) {
      assert.equal(hub.path, `/careers/${hub.slug}`);
      assert.ok(hub.intro.length >= 2);
      assert.ok(hub.relatedSlugs.length >= 2);
      assert.ok(hub.relatedSlugs.every((slug) => getCareerHub(slug)));
      assert.ok(!titles.has(hub.title));
      titles.add(hub.title);
    }
  });

  it("sitemap lists every hub via the shared registry", () => {
    const sitemapSrc = readFileSync(join(ROOT, "src/app/sitemap.ts"), "utf8");
    assert.match(sitemapSrc, /CAREER_HUBS/);
    assert.match(sitemapSrc, /careerHubEntries/);
    assert.match(sitemapSrc, /hub\.path/);
  });

  it("careers route generates static params from the registry", () => {
    const pageSrc = readFileSync(join(ROOT, "src/app/careers/[slug]/page.tsx"), "utf8");
    assert.match(pageSrc, /generateStaticParams/);
    assert.match(pageSrc, /getAllCareerHubSlugs/);
    assert.match(pageSrc, /notFound\(\)/);
  });

  it("careerHubJobsHref encodes location facets for /jobs deep links", () => {
    const href = careerHubJobsHref({ jobsFacets: { location_country: "United States" } });
    assert.ok(href);
    assert.match(href, /country=United/);

    assert.match(
      careerHubJobsHref({ jobsFacets: { location_city: "Chicago" } })!,
      /city=Chicago/,
    );

    assert.equal(careerHubJobsHref({ jobsFacets: undefined }), null);
  });
});

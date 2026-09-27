import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CANADA_CAREER_REDIRECT_DESTINATION,
  REMOVED_CANADA_CAREER_SLUGS,
} from "@/lib/seo/canada-career-redirects";
import { CAREER_HUBS, getAllCareerHubSlugs } from "@/lib/seo/career-hubs";

const ROOT = join(__dirname, "..", "..");

describe("retired Canada career hub redirects", () => {
  it("remote-jobs hub exists as redirect target", () => {
    assert.ok(
      CAREER_HUBS.some((hub) => hub.path === CANADA_CAREER_REDIRECT_DESTINATION),
      CANADA_CAREER_REDIRECT_DESTINATION,
    );
  });

  it("removed slugs are not in CAREER_HUBS or sitemap registry", () => {
    const slugs = new Set(getAllCareerHubSlugs());
    for (const retired of REMOVED_CANADA_CAREER_SLUGS) {
      assert.ok(!slugs.has(retired), `registry still contains ${retired}`);
    }
    const sitemap = readFileSync(join(ROOT, "src/app/sitemap.ts"), "utf8");
    for (const retired of REMOVED_CANADA_CAREER_SLUGS) {
      assert.doesNotMatch(sitemap, new RegExp(retired));
    }
  });

  it("next.config.ts defines permanent redirects to the remote-jobs hub for every retired slug", () => {
    const config = readFileSync(join(ROOT, "next.config.ts"), "utf8");
    assert.match(config, /\.\.\.REMOVED_CANADA_CAREER_SLUGS\.map/);
    assert.match(config, /source: `\/careers\/\$\{slug\}`/);
    assert.match(config, /destination: CANADA_CAREER_REDIRECT_DESTINATION/);
    assert.match(config, /permanent: true/);
    assert.equal(REMOVED_CANADA_CAREER_SLUGS.length, 7);
    assert.equal(CANADA_CAREER_REDIRECT_DESTINATION, "/careers/remote-jobs");
  });
});

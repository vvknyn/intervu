import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import nextConfig from "../../next.config";
import { BLOG_POSTS, blogPostPath } from "../../src/lib/blog/posts";
import { RELATED_PAGE_PATHS, relatedPagesFor } from "../../src/lib/seo/related-pages";
import { SITEMAP_PAGES } from "../../src/lib/seo/indexability";

/**
 * The marketing pages' internal link graph (lib/seo/related-pages.ts). Held to the
 * rules the audit's "under-linked" finding names: contextual links between
 * topically related pages with anchor text that says what is behind them, to
 * addresses that answer 200 and not through a redirect.
 */

const APP = join(process.cwd(), "src", "app");
const GENERIC_ANCHOR = /^(click here|here|read more|learn more|more|link|this page|this)$/i;

const livePaths = new Set<string>([...SITEMAP_PAGES.map((p) => p.path), ...BLOG_POSTS.map((p) => blogPostPath(p.slug))]);

describe("related pages", async () => {
  const redirects = new Set(((await nextConfig.redirects!()) as { source: string }[]).map((r) => r.source));
  redirects.add("/");

  it("covers the comparison pages and the research page (control: an empty graph proves nothing)", () => {
    assert.deepEqual([...RELATED_PAGE_PATHS].sort(), ["/eluta-alternative", "/indeed-alternative", "/linkedin-jobs-alternative", "/research/ghost-jobs"]);
    for (const path of RELATED_PAGE_PATHS) assert.ok(relatedPagesFor(path).length >= 3, `${path} lists at least three pages`);
    assert.deepEqual(relatedPagesFor("/not-in-the-graph"), []);
  });

  for (const path of RELATED_PAGE_PATHS) {
    describe(path, () => {
      const related = relatedPagesFor(path);

      it("every target is a real, submitted page that does not redirect, and is not this page", () => {
        for (const { href } of related) {
          assert.ok(livePaths.has(href), `${href} is not in the sitemap`);
          assert.ok(!redirects.has(href), `${href} redirects`);
          assert.notEqual(href, path, "links to itself");
        }
      });

      it("lists each page once", () => {
        assert.equal(new Set(related.map((r) => r.href)).size, related.length);
      });

      it("each anchor names what it opens and each has a blurb", () => {
        for (const { label, blurb, href } of related) {
          assert.ok(label.trim().split(/\s+/).length >= 2, `${href}: anchor "${label}" is one word`);
          assert.doesNotMatch(label, GENERIC_ANCHOR, href);
          assert.ok(blurb.trim().length >= 30, `${href}: blurb too short`);
        }
      });

      it("keeps the plain-language rule: page text does not use the industry term", () => {
        for (const { label, blurb } of related) assert.doesNotMatch(`${label} ${blurb}`, /ghost/i);
      });
    });
  }

  it("the comparison pages link each other both ways, and all point to the checks and the legit post", () => {
    const comparisons = ["/indeed-alternative", "/linkedin-jobs-alternative", "/eluta-alternative"];
    for (const a of comparisons) {
      const hrefs = relatedPagesFor(a).map((r) => r.href);
      for (const b of comparisons.filter((c) => c !== a)) assert.ok(hrefs.includes(b), `${a} -> ${b}`);
      assert.ok(hrefs.includes("/research/ghost-jobs"), `${a} -> checks`);
      assert.ok(hrefs.includes("/blog/is-velai-legit"), `${a} -> legit post`);
    }
  });

  it("the research page links out to the board, the trends and the legit post", () => {
    const hrefs = relatedPagesFor("/research/ghost-jobs").map((r) => r.href);
    for (const target of ["/jobs", "/trends", "/blog/is-velai-legit"]) assert.ok(hrefs.includes(target), target);
  });

  it("a blog link takes its words from the post, so a renamed post renames its link", () => {
    const entry = relatedPagesFor("/indeed-alternative").find((r) => r.href === "/blog/is-velai-legit");
    const post = BLOG_POSTS.find((p) => p.slug === "is-velai-legit")!;
    assert.equal(entry?.label, post.title);
    assert.equal(entry?.blurb, post.description);
  });

  it("every listed page renders its list (a page in the graph that forgot the component links nothing)", () => {
    const files: Record<string, string> = {
      "/indeed-alternative": "indeed-alternative/page.tsx",
      "/linkedin-jobs-alternative": "linkedin-jobs-alternative/page.tsx",
      "/eluta-alternative": "eluta-alternative/page.tsx",
      "/research/ghost-jobs": "research/ghost-jobs/page.tsx",
    };
    for (const path of RELATED_PAGE_PATHS) {
      const file = join(APP, files[path]);
      assert.ok(existsSync(file), file);
      assert.match(readFileSync(file, "utf8"), /<RelatedLinks\s+path=/, path);
    }
  });
});

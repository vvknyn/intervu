import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  BLOG_AUTHOR,
  BLOG_BYLINE,
  BLOG_POSTS,
  blogCoverAlt,
  blogPostPath,
  blogSearchTitle,
  formatBlogDate,
  getBlogPost,
  renderBlogPost,
} from "@/lib/blog/posts";
import { FOUNDING_SEAT_COUNT, FOUNDING_SEAT_PRICE, PRO_MONTHLY_PRICE } from "@/lib/billing/founding-offer";
import { PUBLIC_SUPPORT_EMAIL } from "@/lib/legal/public-contact";
import { APPLY_BUTTON_LABEL, APPLY_SIGNED_OUT_LABEL } from "@/components/jobs/job-detail-facts";

const PUBLIC = path.join(process.cwd(), "public");

/** A PNG's pixel size, from its IHDR chunk. */
function pngSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(file);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("blog posts", () => {
  it("each post has a unique slug, a real date and a cover from its own pictures", () => {
    const slugs = BLOG_POSTS.map((p) => p.slug);
    assert.equal(new Set(slugs).size, slugs.length);
    for (const post of BLOG_POSTS) {
      assert.match(post.slug, /^[a-z0-9-]+$/);
      assert.match(post.datePublished, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(post.images[post.cover], `${post.slug}: cover ${post.cover} is one of its pictures`);
      // Search results cut descriptions at about 160 characters and titles at about 60.
      assert.ok(post.description.length > 40 && post.description.length <= 160, `${post.slug}: description length`);
      assert.ok(`${blogSearchTitle(post)} · Velai`.length <= 60, `${post.slug}: search title length`);
      assert.ok(blogCoverAlt(post)?.length, `${post.slug}: the cover is shown in the body with alt text`);
    }
  });

  it("every picture a post shows is in public/ at the size the post says", () => {
    for (const post of BLOG_POSTS) {
      const used = [...post.body.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]);
      assert.ok(used.length > 0);
      for (const src of used) assert.ok(post.images[src], `${post.slug}: ${src} has a size`);
      for (const [src, size] of Object.entries(post.images)) {
        const file = path.join(PUBLIC, src);
        assert.ok(existsSync(file), `${src} exists`);
        assert.deepEqual(pngSize(file), size, `${src} size`);
      }
    }
  });

  it("renders pictures at half their pixel size with alt text, not wrapped in a paragraph", () => {
    const post = BLOG_POSTS[0];
    const html = renderBlogPost(post);
    const imgs = [...html.matchAll(/<img [^>]*>/g)].map((m) => m[0]);
    assert.equal(imgs.length, Object.keys(post.images).length);
    for (const img of imgs) {
      assert.match(img, /alt="[^"]{20,}"/);
      assert.match(img, /width="\d+" height="\d+"/);
    }
    assert.doesNotMatch(html, /<p><img/);
    const [src, size] = Object.entries(post.images)[0];
    assert.ok(html.includes(`src="${src}" alt=`));
    assert.ok(html.includes(`width="${size.width / 2}" height="${size.height / 2}"`));
  });

  it("a picture missing from the post's sizes fails loudly instead of rendering unsized", () => {
    const post = { ...BLOG_POSTS[0], body: "![x](/blog/nope.png)" };
    assert.throws(() => renderBlogPost(post), /no size/);
  });

  it("links stay on the site or go to https", () => {
    for (const post of BLOG_POSTS) {
      const hrefs = [...renderBlogPost(post).matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
      for (const href of hrefs) assert.match(href, /^(\/|https:\/\/)/, href);
    }
  });

  it("signs posts with a humble pen name and a drawn SVG avatar, never the founder's real name", () => {
    assert.equal(BLOG_BYLINE, `By ${BLOG_AUTHOR.name}, ${BLOG_AUTHOR.role}`);
    assert.doesNotMatch(BLOG_AUTHOR.name, /vivek|narayanan/i);
    const avatarFile = path.join(PUBLIC, BLOG_AUTHOR.avatar);
    assert.ok(existsSync(avatarFile), `${BLOG_AUTHOR.avatar} exists`);
    const svg = readFileSync(avatarFile, "utf8");
    assert.match(svg, /^<svg\b/);
    assert.doesNotMatch(svg, /<image\b/i);
    for (const post of BLOG_POSTS) {
      assert.doesNotMatch(post.body, /vivek|narayanan/i);
    }
  });

  it("the is-Velai-legit post quotes the live button, prices and address, discloses the pen name, and names no competitor", () => {
    const post = getBlogPost("is-velai-legit");
    assert.ok(post);
    // Checks a reader runs must name the button they will actually see.
    assert.ok(post.body.includes(`**${APPLY_BUTTON_LABEL}**`));
    assert.ok(post.body.includes(`**${APPLY_SIGNED_OUT_LABEL}**`), "a signed-out reader sees this label first");
    for (const fact of [PRO_MONTHLY_PRICE, FOUNDING_SEAT_PRICE, String(FOUNDING_SEAT_COUNT), PUBLIC_SUPPORT_EMAIL]) {
      assert.ok(post.body.includes(fact), fact);
    }
    assert.match(post.body, /refundable on request, for any reason, until Pro opens/);
    // Discloses that the founder writes under the pen name with a drawn picture, not a fake employee photo.
    assert.ok(post.body.includes(`pen name ${BLOG_AUTHOR.name}`));
    assert.match(post.body, /drawn picture rather than a photo/);
    // This page names no other product.
    assert.doesNotMatch(post.body, /jobshifu|hiringcafe|linkedin|indeed/i);
    // Seven numbered checks, as the title and the cover promise.
    assert.equal([...post.body.matchAll(/^\d\. \*\*/gm)].length, 7);
  });

  it("the Velai-vs-JobShifu post quotes Velai's live prices, links JobShifu's public pages, and names where JobShifu goes further", () => {
    const post = getBlogPost("velai-vs-jobshifu");
    assert.ok(post);
    for (const fact of [PRO_MONTHLY_PRICE, FOUNDING_SEAT_PRICE, String(FOUNDING_SEAT_COUNT)]) {
      assert.ok(post.body.includes(fact), fact);
    }
    assert.ok(post.body.includes("**Fill from your résumé**"));
    for (const url of [
      "https://jobshifu.com",
      "https://jobshifu.com/pricing",
      "https://jobshifu.com/privacy",
      "https://jobshifu.com/blog/is-jobshifu-legit",
    ]) {
      assert.ok(post.body.includes(url), url);
    }
    assert.match(post.body, /## What JobShifu has that Velai doesn't/);
    assert.match(post.body, /\$29\.99\/month/);
    assert.match(post.body, /\$14\.99 Week Pass/);
  });

  it("finds posts by slug and dates them as written", () => {
    assert.equal(getBlogPost("whats-new-october-2026")?.slug, "whats-new-october-2026");
    assert.equal(getBlogPost("nope"), null);
    assert.equal(blogPostPath("a-b"), "/blog/a-b");
    assert.equal(formatBlogDate("2026-10-05"), "October 5, 2026");
  });
});

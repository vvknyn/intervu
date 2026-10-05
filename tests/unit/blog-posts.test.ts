import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { BLOG_POSTS, blogPostPath, formatBlogDate, getBlogPost, renderBlogPost } from "@/lib/blog/posts";

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
      assert.ok(post.description.length > 40 && post.description.length < 300, `${post.slug}: description length`);
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

  it("finds posts by slug and dates them as written", () => {
    assert.equal(getBlogPost("whats-new-october-2026")?.slug, "whats-new-october-2026");
    assert.equal(getBlogPost("nope"), null);
    assert.equal(blogPostPath("a-b"), "/blog/a-b");
    assert.equal(formatBlogDate("2026-10-05"), "October 5, 2026");
  });
});

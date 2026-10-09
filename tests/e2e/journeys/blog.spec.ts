import { expect, test } from "./fixtures";

/**
 * Journeys for velai.app/blog — see tests/journeys/CATALOG.md (J-CONTENT-27 to -29, -31).
 * Read-only. The October 2026 "what's new" note is the post the email to
 * registered users links to, so its pictures and its setup link have to work
 * for someone arriving cold. The same-résumé test post (J-CONTENT-29) is the
 * one Vivek links from Reddit, so its chart and its source link have to work.
 */

const POST_PATH = "/blog/whats-new-october-2026";
const TEST_POST_PATH = "/blog/same-resume-test-october-2026";

test("the blog opens from the footer and its first post shows every picture and the setup link", { tag: ["@J-CONTENT-27"] }, async ({ page, diagnostics }) => {
  await page.goto("/about");
  await page.getByRole("navigation", { name: "Company" }).getByRole("link", { name: "Blog", exact: true }).click();
  await expect(page).toHaveURL(/\/blog$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Blog");

  await page.getByTestId("blog-post-link").filter({ hasText: "What's new in Velai" }).click();
  await expect(page).toHaveURL(new RegExp(`${POST_PATH}$`));
  const post = page.getByTestId("blog-post");
  await expect(post.getByRole("heading", { level: 1 })).toHaveText("What's new in Velai: every match says why");
  await expect(post.getByRole("heading", { level: 2, name: "Every match says why" })).toBeVisible();
  await expect(post.getByText("October 5, 2026")).toBeVisible();

  // Four screenshots, each loaded (not a broken image), each with words for a screen reader.
  const pictures = post.locator("img.blog-figure");
  await expect(pictures).toHaveCount(4);
  for (const picture of await pictures.all()) {
    await picture.scrollIntoViewIfNeeded();
    await expect(picture).toHaveAttribute("alt", /.{20,}/);
    await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  }

  await expect(post.getByRole("link", { name: "Set up your matches" })).toHaveAttribute("href", "/jobs?setup=open");
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

test("the same-résumé test post shows its chart, says the gap is within chance, and links HiringCafe's own cost post", { tag: ["@J-CONTENT-29"] }, async ({ page, diagnostics }) => {
  await page.goto("/blog");
  await page.getByTestId("blog-post-link").filter({ hasText: "Same résumé, two job searches" }).click();
  await expect(page).toHaveURL(new RegExp(`${TEST_POST_PATH}$`));
  const post = page.getByTestId("blog-post");
  await expect(post.getByRole("heading", { level: 1 })).toHaveText("Same résumé, two job searches: what a small test showed us");
  await expect(post.getByText("October 9, 2026")).toBeVisible();

  const chart = post.locator("img.blog-figure");
  await expect(chart).toHaveCount(1);
  await chart.scrollIntoViewIfNeeded();
  await expect(chart).toHaveAttribute("alt", /Worth applying to: Velai 85%, HiringCafe 65%/);
  await expect.poll(() => chart.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);

  await expect(post.getByText(/p = 0\.27/)).toBeVisible();
  await expect(post.getByRole("heading", { level: 2, name: "What we got wrong" })).toBeVisible();
  await expect(post.getByRole("link", { name: "their post" })).toHaveAttribute("href", /^https:\/\/www\.reddit\.com\/r\/hiringcafe\//);
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

test("a blog address with no post behind it is a 404, not an empty page", { tag: ["@J-CONTENT-28"] }, async ({ page }) => {
  const response = await page.goto("/blog/no-such-post");
  expect(response?.status()).toBe(404);
});

test("a blog post tells search engines and link previews its title, picture, author and place, and links to the other posts", { tag: ["@J-CONTENT-31"] }, async ({ page, diagnostics }) => {
  await page.goto(TEST_POST_PATH);
  await expect(page).toHaveTitle("Velai vs HiringCafe: same résumé, two job searches · Velai");

  const meta = (selector: string) => page.locator(selector).first().getAttribute("content");
  expect((await meta('meta[name="description"]'))?.length).toBeLessThanOrEqual(160);
  expect(await page.locator('link[rel="canonical"]').getAttribute("href")).toMatch(new RegExp(`${TEST_POST_PATH}$`));
  expect(await meta('meta[property="og:site_name"]')).toBe("Velai");
  expect(await meta('meta[property="og:type"]')).toBe("article");
  expect(await meta('meta[property="og:image"]')).toMatch(/^https?:\/\/.+\/blog\/same-resume-test-october-2026\/results\.png$/);
  expect(await meta('meta[property="og:image:alt"]')).toMatch(/Worth applying to/);
  expect(await meta('meta[name="twitter:card"]')).toBe("summary_large_image");
  expect(await meta('meta[name="twitter:image"]')).toMatch(/results\.png$/);

  const graphs = await page
    .locator('script[type="application/ld+json"]')
    .evaluateAll((nodes) => nodes.map((n) => JSON.parse(n.textContent ?? "{}")));
  const article = graphs.find((g) => g["@type"] === "Article");
  expect(article?.author?.name).toBe("Vivek");
  expect(article?.datePublished).toBe("2026-10-09");
  expect(article?.image?.[0]).toMatch(/results\.png$/);
  const crumbs = graphs.find((g) => g["@type"] === "BreadcrumbList");
  expect(crumbs?.itemListElement?.map((i: { name: string }) => i.name)).toEqual(["Blog", "Same résumé, two job searches: what a small test showed us"]);

  const more = page.getByTestId("blog-more");
  await more.getByRole("link", { name: "What's new in Velai: every match says why" }).click();
  await expect(page).toHaveURL(new RegExp(`${POST_PATH}$`));
  await expect(page.getByTestId("blog-more").getByRole("link", { name: /Same résumé, two job searches/ })).toBeVisible();
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

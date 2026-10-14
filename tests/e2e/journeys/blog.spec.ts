import { expect, test } from "./fixtures";

/**
 * Journeys for velai.app/blog — see tests/journeys/CATALOG.md (J-CONTENT-27 to -29, -32, -33, -36, -38).
 * Read-only. The October 2026 "what's new" note is the post the email to
 * registered users links to, so its pictures and its setup link have to work
 * for someone arriving cold. The same-résumé test post (J-CONTENT-29) is the
 * one we link from Reddit, so its chart and its source link have to work.
 */

const POST_PATH = "/blog/whats-new-october-2026";
const TEST_POST_PATH = "/blog/same-resume-test-october-2026";
const LEGIT_POST_PATH = "/blog/is-velai-legit";
const JOBSHIFU_POST_PATH = "/blog/velai-vs-jobshifu";

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

test("a blog post tells search engines and link previews its title, picture, author and place, and links to the other posts", { tag: ["@J-CONTENT-32"] }, async ({ page, diagnostics }) => {
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
  expect(article?.author).toEqual({ "@type": "Organization", name: "Velai", url: expect.stringMatching(/^https?:\/\//) });
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

test("every blog post is signed with the founder's pen name and drawn avatar, with Velai as the organization in search data", { tag: ["@J-CONTENT-33"] }, async ({ page, diagnostics }) => {
  for (const path of [POST_PATH, TEST_POST_PATH, LEGIT_POST_PATH, JOBSHIFU_POST_PATH]) {
    await page.goto(path);
    const post = page.getByTestId("blog-post");
    await expect(post.getByText("By Alex, founder of Velai", { exact: true })).toBeVisible();
    const avatar = post.getByTestId("blog-author-avatar");
    await expect(avatar).toHaveAttribute("src", "/blog/author.svg");
    await expect.poll(() => avatar.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    await expect(post).not.toContainText(/vivek|narayanan/i);

    expect(await page.locator('meta[name="author"]').getAttribute("content")).toBe("Velai");
    await expect(page.locator('meta[property="article:author"]')).toHaveCount(0);
    const article = (
      await page.locator('script[type="application/ld+json"]').evaluateAll((nodes) => nodes.map((n) => JSON.parse(n.textContent ?? "{}")))
    ).find((g) => g["@type"] === "Article");
    expect(article?.author?.["@type"]).toBe("Organization");
    expect(article?.author?.name).toBe("Velai");
  }
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

test("the is-Velai-legit post opens from /about with its pictures, seven checks, links, and pen-name disclosure", { tag: ["@J-CONTENT-36"] }, async ({ page, diagnostics }) => {
  await page.goto("/about");
  await page.getByTestId("about-page").getByRole("link", { name: "how to check it yourself" }).click();
  await expect(page).toHaveURL(new RegExp(`${LEGIT_POST_PATH}$`));
  await expect(page).toHaveTitle("Is Velai legit? How to check it yourself · Velai");

  const post = page.getByTestId("blog-post");
  await expect(post.getByRole("heading", { level: 1 })).toHaveText("Is Velai legit? What it is, who runs it, and how to check");
  await expect(post.getByText("By Alex, founder of Velai", { exact: true })).toBeVisible();
  for (const name of ["Who runs it", "How Velai pays for itself", "What Velai will never do", "Seven ways to check it yourself"]) {
    await expect(post.getByRole("heading", { level: 2, name })).toBeVisible();
  }
  await expect(post.getByText(/writes on this blog under the pen name Alex, with a drawn picture rather than a photo/)).toBeVisible();

  // The checklist cover and the privacy promises screenshot, each loaded and described.
  const pictures = post.locator("img.blog-figure");
  await expect(pictures).toHaveCount(2);
  for (const picture of await pictures.all()) {
    await picture.scrollIntoViewIfNeeded();
    await expect(picture).toHaveAttribute("alt", /.{40,}/);
    await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  }

  // Seven checks, the second naming the button a reader will press.
  const checks = post.locator("ol > li");
  await expect(checks).toHaveCount(7);
  await expect(checks.nth(1)).toContainText("Apply on employer site");

  await expect(post.getByRole("link", { name: "Velai's job search" })).toHaveAttribute("href", "/jobs");
  await expect(post.getByRole("link", { name: "pricing page" })).toHaveAttribute("href", "/pricing");
  await expect(post.getByRole("link", { name: "privacy policy" })).toHaveAttribute("href", "/privacy#your-resume");
  await expect(post.getByRole("link", { name: "tell us" })).toHaveAttribute("href", "/contact");
  await expect(post).not.toContainText(/vivek|narayanan/i);
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

test("the Velai-vs-JobShifu post opens from /blog with its comparison table picture, where JobShifu goes further, and links to both services", { tag: ["@J-CONTENT-38"] }, async ({ page, diagnostics }) => {
  await page.goto("/blog");
  await page.getByTestId("blog-post-link").filter({ hasText: "Velai and JobShifu" }).click();
  await expect(page).toHaveURL(new RegExp(`${JOBSHIFU_POST_PATH}$`));
  await expect(page).toHaveTitle("Velai vs JobShifu: how the two job tools compare · Velai");

  const post = page.getByTestId("blog-post");
  await expect(post.getByRole("heading", { level: 1 })).toHaveText("Velai and JobShifu: how the two job tools compare");
  await expect(post.getByText("By Alex, founder of Velai", { exact: true })).toBeVisible();
  for (const name of [
    "Where the jobs come from, and how you search",
    "Tailoring your résumé without making things up",
    "Filling out applications and the Chrome extension",
    "What JobShifu has that Velai doesn't",
    "Privacy and where your résumé goes",
    "What each one costs",
    "Which one to pick",
  ]) {
    await expect(post.getByRole("heading", { level: 2, name })).toBeVisible();
  }

  const figure = post.locator("img.blog-figure");
  await expect(figure).toHaveCount(1);
  await figure.scrollIntoViewIfNeeded();
  await expect(figure).toHaveAttribute("alt", /Side-by-side comparison of Velai and JobShifu/);
  await expect.poll(() => figure.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);

  await expect(post.getByRole("link", { name: "JobShifu", exact: true })).toHaveAttribute("href", "https://jobshifu.com");
  await expect(post.getByRole("link", { name: "JobShifu's privacy policy" })).toHaveAttribute("href", "https://jobshifu.com/privacy");
  await expect(post.getByRole("link", { name: "MCP" })).toHaveAttribute("href", "/connect");
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

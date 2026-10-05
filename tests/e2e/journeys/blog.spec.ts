import { expect, test } from "./fixtures";

/**
 * Journeys for velai.app/blog — see tests/journeys/CATALOG.md (J-CONTENT-27, -28).
 * Read-only. The first post is the October 2026 "what's new" note; the email
 * to registered users links to it, so its pictures and its setup link have
 * to work for someone arriving cold.
 */

const POST_PATH = "/blog/whats-new-october-2026";

test("the blog opens from the footer and its first post shows every picture and the setup link", { tag: ["@J-CONTENT-27"] }, async ({ page, diagnostics }) => {
  await page.goto("/about");
  await page.getByRole("navigation", { name: "Company" }).getByRole("link", { name: "Blog", exact: true }).click();
  await expect(page).toHaveURL(/\/blog$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Blog");

  await page.getByTestId("blog-post-link").first().click();
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

test("a blog address with no post behind it is a 404, not an empty page", { tag: ["@J-CONTENT-28"] }, async ({ page }) => {
  const response = await page.goto("/blog/no-such-post");
  expect(response?.status()).toBe(404);
});

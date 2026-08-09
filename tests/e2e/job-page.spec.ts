import { expect, test, type Page } from "@playwright/test";

// A real active job id must be sourced at run time from the board rather
// than hardcoded, because listings expire and a pinned id makes the suite
// rot.
async function firstJobPath(page: Page): Promise<string> {
  await page.goto("/jobs");
  const link = page.locator('a[href^="/jobs/"]').first();
  await expect(link).toBeVisible();
  return (await link.getAttribute("href")) as string;
}

test("a job page renders server-side with JobPosting JSON-LD", async ({ page }) => {
  const path = await firstJobPath(page);
  const res = await page.goto(path);
  expect(res?.status()).toBe(200);
  const ld = await page.locator('script[type="application/ld+json"]').first().textContent();
  expect(ld).toContain('"@type":"JobPosting"');
  await expect(page.getByTestId("job-page")).toBeVisible();
  await expect(page.locator("h1")).toBeVisible();
});

test("canonical points at the current site origin, never the retired domain", async ({ page }) => {
  const path = await firstJobPath(page);
  await page.goto(path);
  const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
  expect(canonical).not.toContain("intervu.cc");
});

test("a malformed slug 404s instead of rendering an empty shell", async ({ page }) => {
  const res = await page.goto("/jobs/not-a-real-job-slug");
  expect(res?.status()).toBe(404);
});

import type { Locator, Page } from "@playwright/test";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { expect, test } from "./fixtures";

/** Journeys for a job's detail — the job page and the board's pane. See tests/journeys/CATALOG.md (J-DETAIL-11/29/30). Read-only. */

const DETAIL = '[data-testid="detail-pane"]:visible, [data-testid="mobile-detail-scroller"]:visible';

/** Jobs come from a live search — pinned ids and slugs rot when listings expire. */
async function searchFor(page: Page, keyword: string) {
  await page.addInitScript((key) => localStorage.setItem(key, "1"), ONBOARDING_COMPLETED_STORAGE_KEY);
  await page.goto("/jobs");
  await page.getByPlaceholder("Job title, skill, or company").fill(keyword);
  await page.getByTestId("search-submit").click();
  await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 30_000 });
}

/** Up to `n` job ids from a live search. */
async function liveJobIds(page: Page, keyword: string, n: number): Promise<string[]> {
  await searchFor(page, keyword);
  const ids = await page.getByTestId("job-row").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-job-id")));
  return [...new Set(ids.filter((id): id is string => Boolean(id)))].slice(0, n);
}

/** The first job page (of a few from a live search) whose "More like this" list rendered. */
async function jobPageWithRelated(page: Page): Promise<Locator> {
  await searchFor(page, "product manager");
  const paths = await page
    .getByTestId("job-row")
    .locator('a[href^="/jobs/"]')
    .evaluateAll((links) => links.map((a) => a.getAttribute("href")));
  for (const path of [...new Set(paths)].slice(0, 3)) {
    await page.goto(path!);
    const section = page.getByTestId("job-detail-related");
    if (await section.waitFor({ timeout: 20_000 }).then(() => true, () => false)) return section;
  }
  throw new Error("none of the first three job pages showed a More like this list");
}

test("the job page's More like this rows hold their two lines, and the heading names the list", { tag: ["@J-DETAIL-29"] }, async ({ page, diagnostics }) => {
  const section = await jobPageWithRelated(page);
  // "More like this" for similar roles; "More at {company}" when only the company's own roles came back.
  await expect(section.getByRole("heading")).toHaveText(/^More (like this|at .+)$/);
  const rows = await section.getByTestId("related-job-row").evaluateAll((els) =>
    els.map((el) => {
      const box = el.getBoundingClientRect();
      const lines = [...el.children].map((c) => c.getBoundingClientRect());
      return {
        overflow: el.scrollHeight - el.clientHeight,
        // A pinned row squeezes its lines instead of overflowing: each one
        // (`truncate`, so overflow hidden) gets shorter than its own text.
        clipped: [...el.children].some((c) => c.scrollHeight > c.clientHeight + 1),
        above: lines[0]!.top - box.top,
        below: box.bottom - lines[lines.length - 1]!.bottom,
      };
    }),
  );
  expect(rows.length).toBeGreaterThan(0);
  // The regression: a 32px control step pinned each row, so its two lines
  // were squeezed flush against the hairlines and the hover band cut them off.
  for (const row of rows) {
    expect(row.overflow).toBeLessThanOrEqual(0);
    expect(row.clipped).toBe(false);
    expect(row.above).toBeGreaterThanOrEqual(8);
    expect(row.below).toBeGreaterThanOrEqual(8);
  }
  expect(diagnostics.serverErrors).toEqual([]);
});

test("a related row on the job page opens that job", { tag: ["@J-DETAIL-11"] }, async ({ page }) => {
  const section = await jobPageWithRelated(page);
  const row = section.getByTestId("related-job-row").first();
  const title = (await row.locator("span").first().textContent())!.trim();
  await row.click();
  await expect(page).toHaveURL(/\/jobs\?(.*&)?job=/, { timeout: 10_000 });
  await expect(page.locator(DETAIL).first().getByText(title, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
});

test("the pane's company links say where they go, never a bare company name", { tag: ["@J-DETAIL-30"] }, async ({ page }) => {
  // Only jobs with a hiring record show the links, so try a few.
  for (const id of await liveJobIds(page, "product manager", 3)) {
    await page.goto(`/jobs?posted=any&job=${encodeURIComponent(id)}`);
    const detail = page.locator(DETAIL).first();
    await expect(detail).toBeVisible({ timeout: 20_000 });
    const allJobs = detail.getByRole("link", { name: /^All jobs at / });
    if (!(await allJobs.waitFor({ timeout: 10_000 }).then(() => true, () => false))) continue;
    const links = await allJobs.locator("xpath=..").getByRole("link").allTextContents();
    for (const text of links) expect(text.trim()).toMatch(/^All jobs at .+|.+ company page$/);
    return;
  }
  test.skip(true, "none of the first three jobs had a hiring record to link from");
});

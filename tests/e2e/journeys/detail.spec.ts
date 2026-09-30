import type { Locator, Page } from "@playwright/test";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { expect, test } from "./fixtures";

/** Journeys for a job's detail — the job page and the board's pane — and opening and closing it from a row. See tests/journeys/CATALOG.md (J-DETAIL-11/29-33, J-JOBS-11/53). Read-only. */

const DETAIL = '[data-testid="detail-pane"]:visible, [data-testid="mobile-detail-scroller"]:visible';
/** The one "Customize résumé" (with a résumé) or "Upload résumé to customize." (without) button. */
const CUSTOMIZE = '[data-testid="local-customize-open"]:visible, [data-testid="job-detail-upload-to-customize"]:visible';

/** How far the page scrolls sideways; 0 when everything fits the screen. */
function sidewaysScroll(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** Labels of the buttons and links in `scope` that run past its right edge or the screen's. */
function spilled(scope: Locator) {
  return scope.evaluate((root) => {
    const edge = Math.min(document.documentElement.clientWidth, root.getBoundingClientRect().right);
    return [...root.querySelectorAll<HTMLElement>("button, a")]
      .filter((el) => el.offsetParent !== null && el.getBoundingClientRect().right > edge + 1)
      .map((el) => el.getAttribute("aria-label") || el.textContent!.trim());
  });
}

function isDesktop(page: Page) {
  return page.viewportSize()!.width >= 1024;
}

/** Clicks the open job's × (the split pane's own at 1440, the sheet's header at 390) once it holds still: the sheet grows as the job loads, which moves it. */
async function closeJob(page: Page) {
  const surface = page.viewportSize()!.width >= 1280 ? page.getByTestId("detail-pane") : page.getByRole("dialog");
  const close = surface.getByRole("button", { name: "Close", exact: true }).first();
  let last = "";
  await expect
    .poll(async () => {
      const now = JSON.stringify(await close.boundingBox());
      const still = now === last && now !== "null";
      last = now;
      return still;
    }, { intervals: [400], timeout: 20_000 })
    .toBe(true);
  await close.click();
}

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

/** Up to `n` job page paths from a live search. */
async function liveJobPaths(page: Page, keyword: string, n: number): Promise<string[]> {
  await searchFor(page, keyword);
  const paths = await page
    .getByTestId("job-row")
    .locator('a[href^="/jobs/"]')
    .evaluateAll((links) => links.map((a) => a.getAttribute("href")));
  return [...new Set(paths.filter((p): p is string => Boolean(p)))].slice(0, n);
}

/** The first job page (of a few from a live search) whose "More like this" list rendered. */
async function jobPageWithRelated(page: Page): Promise<Locator> {
  for (const path of await liveJobPaths(page, "product manager", 3)) {
    await page.goto(path);
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
      const title = el.querySelector('[data-testid="related-job-title"]')!;
      const lineEls = [...title.parentElement!.children];
      const lines = lineEls.map((c) => c.getBoundingClientRect());
      return {
        overflow: el.scrollHeight - el.clientHeight,
        // A pinned row squeezes its lines instead of overflowing: each one
        // (`truncate`, so overflow hidden) gets shorter than its own text.
        clipped: lineEls.some((c) => c.scrollHeight > c.clientHeight + 1),
        above: lines[0]!.top - box.top,
        below: box.bottom - lines[lines.length - 1]!.bottom,
        // The hover band and the focus ring are the row's box: the text sits inside it.
        inset: lines[0]!.left - box.left,
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
    expect(row.inset).toBeGreaterThanOrEqual(12);
  }

  // Keyboard focus draws an inset ring inside the row, not the browser outline over the text.
  const first = section.getByTestId("related-job-row").first();
  await first.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  const focus = await first.evaluate((el) => ({ active: document.activeElement === el, outline: getComputedStyle(el).outlineStyle, ring: getComputedStyle(el).boxShadow }));
  expect(focus.active).toBe(true);
  expect(focus.outline).toBe("none");
  expect(focus.ring).toMatch(/inset/);
  expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
  expect(diagnostics.serverErrors).toEqual([]);
});

test("a related row on the job page opens that job's own page, and Back returns", { tag: ["@J-DETAIL-11"] }, async ({ page }) => {
  const section = await jobPageWithRelated(page);
  const from = new URL(page.url()).pathname;
  const row = section.getByTestId("related-job-row").first();
  const title = (await row.getByTestId("related-job-title").textContent())!.trim();
  // A link to the job's page, not a button into the board (which it was until 2026-09-30).
  const href = (await row.getAttribute("href"))!;
  expect(href).toMatch(/^\/jobs\/[^/?#]+$/);
  await row.click();
  await expect(page).toHaveURL((url) => url.pathname === href, { timeout: 10_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title, { timeout: 20_000 });
  await page.goBack();
  await expect(page).toHaveURL((url) => url.pathname === from, { timeout: 10_000 });
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

test("the job page shows its keywords and check rows on desktop, one tap away on a phone", { tag: ["@J-DETAIL-31"] }, async ({ page, diagnostics }) => {
  // A closed <details> hid them at every width, whatever `lg:!block` said (2026-09-30).
  const [path] = await liveJobPaths(page, "product manager", 1);
  await page.goto(path!);
  const receipt = page.getByTestId("job-detail-receipt");
  await expect(receipt).toBeVisible({ timeout: 20_000 });
  const checkRow = receipt.locator("b").first();
  const toggle = receipt.getByRole("button", { name: /^(Show|Hide) details$/ });
  if (isDesktop(page)) {
    await expect(checkRow).toBeVisible();
    await expect(toggle).toBeHidden();
    const keywords = page.getByTestId("job-detail-keywords");
    if ((await keywords.count()) > 0) await expect(keywords).toBeVisible();
  } else {
    await expect(checkRow).toBeHidden();
    await expect(toggle).toHaveText("Show details");
    await toggle.click();
    await expect(checkRow).toBeVisible();
    await expect(toggle).toHaveText("Hide details");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  }
  expect(diagnostics.pageErrors).toEqual([]);
});

test("the job page's actions fit the screen: Apply and Save in the phone bar, Upload or Customize in the page", { tag: ["@J-DETAIL-32"] }, async ({ page, diagnostics }) => {
  const [path] = await liveJobPaths(page, "product manager", 1);
  await page.goto(path!);
  // A guest has no résumé, so this is "Upload résumé to customize.": one of them, on its own row.
  await expect(page.locator(CUSTOMIZE)).toHaveCount(1, { timeout: 20_000 });
  if (isDesktop(page)) {
    expect(await spilled(page.getByTestId("job-detail-apply-card"))).toEqual([]);
  } else {
    // It sat beside Apply and Save in the bar and ran about 100px off a 390px screen (2026-09-30).
    const bar = page.getByTestId("job-detail-action-bar");
    await expect(bar).toBeVisible();
    await expect(bar.locator(CUSTOMIZE)).toHaveCount(0);
    expect(await spilled(bar)).toEqual([]);
  }
  expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
  expect(diagnostics.pageErrors).toEqual([]);
});

test("the board's role view has one Upload or Customize button, and its phone bar fits the screen", { tag: ["@J-DETAIL-33"] }, async ({ page, diagnostics }) => {
  const [id] = await liveJobIds(page, "product manager", 1);
  await page.goto(`/jobs?posted=any&job=${encodeURIComponent(id!)}`);
  const detail = page.locator(DETAIL).first();
  await expect(detail).toBeVisible({ timeout: 20_000 });
  // The phone sheet repeated it in its sticky bar, which then ran off the screen (2026-09-30).
  await expect(detail.locator(CUSTOMIZE)).toHaveCount(1, { timeout: 20_000 });
  if (!isDesktop(page)) {
    const bar = detail.getByTestId("job-detail-action-bar");
    await expect(bar).toBeVisible();
    await expect(bar.locator(CUSTOMIZE)).toHaveCount(0);
    expect(await spilled(bar)).toEqual([]);
  }
  expect(diagnostics.pageErrors).toEqual([]);
});

test("closing a job opened from a shared link stays on /jobs with ?job= cleared; one opened from the list steps back", { tag: ["@J-JOBS-11"] }, async ({ page, context, diagnostics }) => {
  const [id] = await liveJobIds(page, "product manager", 1);
  // From the list: the open pushed ?job=, so the close is Back to the search it came from.
  const listUrl = page.url();
  await page.getByTestId("job-row").first().getByTestId("job-title").click();
  await expect(page).toHaveURL(/[?&]job=/, { timeout: 10_000 });
  await closeJob(page);
  await expect(page).toHaveURL(listUrl, { timeout: 10_000 });

  // A shared link in a fresh tab has no page of ours before it: the × went Back off the site, or did nothing (2026-09-30).
  const shared = await context.newPage();
  await shared.goto(`/jobs?posted=any&job=${encodeURIComponent(id!)}`);
  const detail = shared.locator(DETAIL).first();
  await expect(detail).toBeVisible({ timeout: 20_000 });
  await closeJob(shared);
  await expect(shared).toHaveURL((url) => url.pathname === "/jobs" && url.searchParams.get("posted") === "any" && !url.searchParams.has("job"), { timeout: 10_000 });
  if (!isDesktop(shared)) await expect(shared.getByTestId("mobile-detail-scroller")).toBeHidden();
  await expect(shared.getByTestId("job-row").first()).toBeVisible({ timeout: 30_000 });
  expect(diagnostics.pageErrors).toEqual([]);
});

test("on a phone a tap anywhere on a job row opens that job, and the job links its company page", { tag: ["@J-JOBS-53"] }, async ({ page, diagnostics }) => {
  await searchFor(page, "data analyst");
  // A row whose company has a page: its name is a link from lg up.
  const row = page.getByTestId("job-row").filter({ has: page.getByTestId("job-row-company") }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  const id = (await row.getAttribute("data-job-id"))!;
  const company = row.getByTestId("job-row-company");
  if (isDesktop(page)) {
    await expect(company).toBeVisible();
    await company.click();
    await expect(page).toHaveURL(/\/co\//, { timeout: 20_000 });
    return;
  }
  // The name filled the middle of a phone row, so a tap there opened the company page (2026-09-30).
  await expect(company).toBeHidden();
  await row.click();
  await expect(page).toHaveURL((url) => url.pathname === "/jobs" && url.searchParams.get("job") === id, { timeout: 10_000 });
  const sheet = page.getByTestId("mobile-detail-scroller");
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('a[href^="/co/"]').first()).toBeVisible({ timeout: 20_000 });
  expect(diagnostics.pageErrors).toEqual([]);
});

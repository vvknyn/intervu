import type { Page } from "@playwright/test";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { expect, test } from "./fixtures";
import { answerListSearch } from "./list-search";
import { withActionResult } from "./signed-in";

/** Journeys for what the board's detail pane draws below the description: its width, and the employer's hiring record. See tests/journeys/CATALOG.md (J-DETAIL-46/47). Read-only. */

test.afterEach(({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));

const PARAGRAPH =
  "You will own the roadmap for our platform team, working with designers, engineers and customers every week to decide what ships next and why, and to explain those decisions plainly to people who were not in the room when they were made.";

const DOMAIN = "measure-journey.example";

const role = {
  id: "measure-journey", title: "Product Manager", company: "Measure Journey", company_domain: DOMAIN, location: "Remote, Canada",
  location_city: null, location_state: null, location_country: null, work_type: "remote", employment_type: "full_time", experience_level: "mid",
  salary_min: null, salary_max: null, salary_currency: null, salary_period: null, visa_sponsorship: null, tags: ["roadmap"],
  apply_url: "https://example.com/apply", source: "e2e", posted_at: new Date().toISOString(), first_seen_at: null, updated_at: null,
  vacancy_status: "open", ghost_badge: null,
  description: `About the role\n\n${PARAGRAPH}\n\n${PARAGRAPH}\n\n${PARAGRAPH}`,
};

const WEEKS = ["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19"].map((weekStartIso, i) => ({
  weekStartIso, newListings: [3, 0, 5, 2][i], firstTracked: false, inProgress: i === 3,
}));

const SENTENCE = "Last 13 weeks: 10 roles opened, 4 closed.";

/**
 * Opens the role in the pane. The two single-domain reads under the description (live roles, hiring record) are
 * answered with one object that satisfies both: `{ value, isLowerBound }` for the count, `{ sentence, cadence }` for the record.
 */
async function openRole(page: Page, cadence: object | null) {
  await page.addInitScript((key) => localStorage.setItem(key, "1"), ONBOARDING_COMPLETED_STORAGE_KEY);
  await page.route("**/api/jobs/search", (route) =>
    answerListSearch(route, { hits: [role], total: 1, backend: "meilisearch", configured: true, searchId: "e2e-detail-measure" }),
  );
  await page.route(
    () => true,
    async (route) => {
      const req = route.request();
      if (req.method() !== "POST" || !req.headers()["next-action"] || req.postData() !== JSON.stringify([DOMAIN])) return route.fallback();
      const res = await route.fetch().catch(() => null);
      if (!res) return;
      const view = { sentence: SENTENCE, cadence: cadence && { data: { weeks: WEEKS }, source: "job_listings", label: "Job listings", asOf: "2026-10-24T00:00:00Z" } };
      return route.fulfill({ response: res, body: withActionResult(await res.text(), { value: 20, isLowerBound: false, ...view }) });
    },
  );
  await page.goto("/jobs?q=product+manager&posted=any");
  await page.getByTestId("job-row").getByTestId("job-title").first().click({ timeout: 60_000 });
  const pane = page.locator('[data-testid="detail-pane"]:visible, [data-testid="mobile-detail-scroller"]:visible').first();
  await expect(pane.getByTestId("job-detail-description")).toBeVisible({ timeout: 30_000 });
  return pane;
}

test("the opened role's hiring record draws the company page's weekly bars under the sentence; with no weeks there is only the sentence", { tag: ["@J-DETAIL-46"] }, async ({ page, diagnostics }) => {
  const pane = await openRole(page, {});
  const chart = pane.getByTestId("job-detail-hiring-chart");
  await expect(pane.getByTestId("job-detail-hiring-record")).toHaveText(SENTENCE, { timeout: 30_000 });
  await expect(chart.getByTestId("company-cadence-week")).toHaveCount(WEEKS.length);
  await expect(chart.getByTestId("company-cadence-week").nth(2)).toContainText("5");
  // The phone's column is ~358px: the bars and their counts fit it.
  const box = (await chart.boundingBox())!;
  const week = await chart.getByTestId("company-cadence-week").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().right));
  expect(Math.max(...week)).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  expect(diagnostics.pageErrors).toEqual([]);
});

test("a hiring record without weekly bars shows its sentence and no chart", { tag: ["@J-DETAIL-46"] }, async ({ page, diagnostics }) => {
  const pane = await openRole(page, null);
  await expect(pane.getByTestId("job-detail-hiring-record")).toHaveText(SENTENCE, { timeout: 30_000 });
  await expect(pane.getByTestId("job-detail-hiring-chart")).toHaveCount(0);
  expect(diagnostics.pageErrors).toEqual([]);
});

test("a description fills its pane: the body reads wider than 600px at 1440", { tag: ["@J-DETAIL-47"] }, async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) < 1280, "the split pane is a desktop layout");
  const pane = await openRole(page, null);
  const paragraph = pane.getByTestId("job-detail-description").locator("p").first();
  await expect(paragraph).toBeVisible();
  expect((await paragraph.boundingBox())!.width).toBeGreaterThan(600);
});

import type { Page, Route } from "@playwright/test";
import { APPLY_RETURN_STORAGE_KEY } from "../../../src/lib/jobs/apply-return";
import { expect, test } from "./fixtures";
import { answerListSearch, isListSearch } from "./list-search";

/**
 * "Did you apply?" after coming back from the employer's site — see
 * tests/journeys/CATALOG.md (J-APPLY-*). Signed in through the dev-only
 * `window.__INTERVU_E2E_AUTH__` hook (production builds ignore it), so these
 * skip themselves against any other origin. Nothing is written: the search
 * returns one stub role and "Yes" is answered in the browser.
 */

const isLocal = (baseURL: string | undefined) => /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseURL ?? "http://localhost:3000");

/** Next server-action response in flight format: `1:` carries the action's return value. */
const flight = (value: unknown) => `0:{"a":"$@1","f":"","q":"","i":true,"b":"development"}\n1:D"$2"\n1:${JSON.stringify(value)}\n`;

const POSTED = new Date(Date.now() - 6 * 3_600_000).toISOString();
const JOB = {
  id: "journey-apply-1",
  title: "Backend Engineer, Payments",
  company: "Acme Payments",
  company_domain: null,
  location: "Toronto, ON, Canada",
  location_city: "Toronto",
  location_state: "ON",
  location_country: "Canada",
  work_type: "hybrid",
  employment_type: "full_time",
  experience_level: "mid",
  salary_min: null,
  salary_max: null,
  salary_currency: null,
  salary_period: null,
  visa_sponsorship: null,
  tags: [],
  apply_url: "https://jobs.example.com/acme/backend-engineer",
  source: "greenhouse",
  posted_at: POSTED,
  first_seen_at: POSTED,
  posted_ts: Date.parse(POSTED),
  updated_at: POSTED,
  vacancy_status: "open",
  ghost_badge: "clear",
  tier: 1,
};

/** Signs in, answers the board search with `JOB`, and records every "mark applied" call. */
async function signedInBoard(page: Page) {
  const markApplied: string[] = [];
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__INTERVU_E2E_AUTH__ = { uid: "u1", email: "jane@example.com", displayName: "Jane Doe" };
    localStorage.setItem("intervu.onboarding.completed", "1");
  });
  await page.route(
    () => true,
    async (route: Route) => {
      const req = route.request();
      const body = req.postData() ?? "";
      if (isListSearch(req) && body.startsWith('{"q"') && body.includes('"withFacets"')) {
        return answerListSearch(route, { hits: [JOB], total: 1, backend: "meilisearch", configured: true, searchId: "journey-apply", query: "backend engineer" });
      }
      if (req.method() !== "POST" || !req.headers()["next-action"]) return route.continue();
      const res = await route.fetch();
      if (body.includes('"applyUrl"')) {
        markApplied.push(body);
        return route.fulfill({ response: res, body: flight({ data: { id: "pursuit-journey-1" } }) });
      }
      return route.fulfill({ response: res });
    },
  );
  await page.goto("/jobs?q=backend%20engineer&posted=any");
  await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 30_000 });
  return markApplied;
}

/** What the Apply click leaves behind, as if the visitor left 30 s ago; then they come back. */
async function returnFromEmployerSite(page: Page) {
  await page.evaluate(
    ([key, job]) => {
      sessionStorage.setItem(
        key,
        JSON.stringify({ jobId: job.id, title: job.title, company: job.company, leftAt: Date.now() - 30_000, prompted: false, applyUrl: job.apply_url }),
      );
      window.dispatchEvent(new Event("focus"));
    },
    [APPLY_RETURN_STORAGE_KEY, JOB] as const,
  );
}

test.afterEach(({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));

test.describe("signed in (dev-server only)", () => {
  test.beforeEach(({ baseURL }) => {
    test.skip(!isLocal(baseURL), "signed-in apply-return needs the dev-only __INTERVU_E2E_AUTH__ hook, which production builds ignore");
  });

  test("On a phone, coming back to the job sheet asks \"Did you apply?\" inside it, and Yes saves the role with its posting", { tag: ["@J-APPLY-26"] }, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "the job opens in a sheet only below xl");
    const markApplied = await signedInBoard(page);
    await page.getByTestId("job-row").first().getByTestId("job-title").click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();

    await returnFromEmployerSite(page);
    const prompt = sheet.getByTestId("apply-return-prompt-inline");
    await expect(prompt).toBeVisible();
    await expect(prompt).toContainText(JOB.title);
    // The floating chip is hidden behind any open sheet, so it must not also be mounted.
    await expect(page.getByTestId("apply-return-prompt")).toHaveCount(0);

    await prompt.getByTestId("apply-return-mark-applied").click();
    await expect(page.getByText("Applied — nice work")).toBeVisible();
    await expect(prompt).toHaveCount(0);
    expect(markApplied).toHaveLength(1);
    expect(JSON.parse(markApplied[0])[0]).toMatchObject({ jobId: JOB.id, applyUrl: JOB.apply_url });
  });

  test("On a phone, Not yet closes the question in the sheet without saving, and it doesn't come back", { tag: ["@J-APPLY-27"] }, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "the job opens in a sheet only below xl");
    const markApplied = await signedInBoard(page);
    await page.getByTestId("job-row").first().getByTestId("job-title").click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();

    await returnFromEmployerSite(page);
    await sheet.getByTestId("apply-return-not-yet").click();
    await expect(sheet.getByTestId("apply-return-prompt-inline")).toHaveCount(0);

    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByTestId("apply-return-prompt")).toHaveCount(0);
    expect(markApplied).toHaveLength(0);
  });

  test("On a wide screen the job opens beside the list and the question floats over the page", { tag: ["@J-APPLY-28"] }, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "the detail pane replaces the sheet at xl and up");
    const markApplied = await signedInBoard(page);
    await page.getByTestId("job-row").first().getByTestId("job-title").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await returnFromEmployerSite(page);
    const prompt = page.getByTestId("apply-return-prompt");
    await expect(prompt).toBeVisible();
    await expect(page.getByTestId("apply-return-prompt-inline")).toHaveCount(0);

    await prompt.getByTestId("apply-return-mark-applied").click();
    await expect(page.getByText("Applied — nice work")).toBeVisible();
    expect(JSON.parse(markApplied[0])[0]).toMatchObject({ jobId: JOB.id, applyUrl: JOB.apply_url });
  });
});

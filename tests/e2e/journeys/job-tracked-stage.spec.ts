import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * A role you track shows where it stands on its job page — see
 * tests/journeys/CATALOG.md (J-DETAIL-31/32). Guest tracker only (roles saved
 * in this browser), so nothing is written. Locally the search is answered
 * with one stub role; anywhere else the first live result is used.
 */

const isLocal = (baseURL: string | undefined) => /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseURL ?? "http://localhost:3000");

/** A server-action response with its value swapped: keeps the real header line (it carries the
 *  build id, which a production build checks) and puts `value` on the `1:` line. */
const withActionValue = (real: string, value: unknown) => `${real.split("\n")[0]}\n1:${JSON.stringify(value)}\n`;

const GUEST_PURSUITS_KEY = "intervu.pursuits.guest";
const SEARCH = "/jobs?q=engineer&posted=any";
const POSTED = new Date(Date.now() - 6 * 3_600_000).toISOString();
const STUB_JOB = {
  id: "journey-tracked-1",
  title: "Platform Engineer",
  company: "Acme Cloud",
  company_domain: null,
  location: "Toronto, ON, Canada",
  location_city: "Toronto",
  location_state: "ON",
  location_country: "Canada",
  work_type: "remote",
  employment_type: "full_time",
  experience_level: "senior",
  salary_min: null,
  salary_max: null,
  salary_currency: null,
  salary_period: null,
  visa_sponsorship: null,
  tags: [],
  apply_url: "https://jobs.example.com/acme/platform-engineer",
  source: "greenhouse",
  posted_at: POSTED,
  first_seen_at: POSTED,
  posted_ts: Date.parse(POSTED),
  updated_at: POSTED,
  vacancy_status: "open",
  ghost_badge: "clear",
  tier: 1,
};

/** Opens the board and returns the first role's id and title (the stub role locally). */
async function firstRole(page: Page, local: boolean): Promise<{ id: string; title: string }> {
  await page.addInitScript(() => localStorage.setItem("intervu.onboarding.completed", "1"));
  if (local) {
    await page.route(
      () => true,
      async (route) => {
        const req = route.request();
        const body = req.postData() ?? "";
        if (req.method() !== "POST" || !req.headers()["next-action"] || !(body.startsWith('[{"q"') && body.includes('"withFacets"'))) {
          return route.continue();
        }
        const res = await route.fetch();
        return route.fulfill({
          response: res,
          body: withActionValue(await res.text(), { hits: [STUB_JOB], total: 1, backend: "meilisearch", configured: true, searchId: "journey-tracked", query: "engineer" }),
        });
      },
    );
  }
  await page.goto(SEARCH);
  const row = page.getByTestId("job-row").first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  const title = (await row.getByTestId("job-title").innerText()).trim();
  await row.getByTestId("job-title").click();
  await expect(page).toHaveURL(/[?&]job=/);
  const id = new URL(page.url()).searchParams.get("job") ?? "";
  return { id, title };
}

test.afterEach(({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));

test("A role in your tracker says where it stands on its job page, and Update status opens it in the tracker", { tag: ["@J-DETAIL-31"] }, async ({ page, baseURL }) => {
  const local = isLocal(baseURL);
  const role = await firstRole(page, local);
  const appliedAt = new Date(Date.now() - 2 * 86_400_000).toISOString();
  await page.evaluate(
    ([key, role, appliedAt]) => {
      localStorage.setItem(
        key,
        JSON.stringify([
          {
            id: "guest-journey-tracked",
            user_id: "guest",
            company_name: "Acme",
            position: role.title,
            status: "applied",
            job_id: role.id,
            job_snapshot: { title: role.title, company: "Acme", location: null, description: null, apply_url: "" },
            applied_at: appliedAt,
            created_at: appliedAt,
            updated_at: appliedAt,
          },
        ]),
      );
    },
    [GUEST_PURSUITS_KEY, role, appliedAt] as const,
  );
  await page.reload();

  const line = page.getByTestId("job-tracked-stage").first();
  // The reload re-runs the search before the role reopens; a dev server can take a while.
  await expect(line).toBeVisible({ timeout: 20_000 });
  await expect(line).toContainText("In your tracker: Applied");
  await expect(line).toContainText("applied 2d ago");
  const link = line.getByTestId("job-tracked-stage-link");
  await expect(link).toHaveAttribute("href", "/yours/guest-journey-tracked");

  await link.click();
  await expect(page).toHaveURL(/\/yours\/guest-journey-tracked$/, { timeout: 30_000 });
  await expect(page.getByText(role.title).first()).toBeVisible();
});

test("A role you don't track shows no tracker line", { tag: ["@J-DETAIL-32"] }, async ({ page, baseURL }) => {
  await firstRole(page, isLocal(baseURL));
  await expect(page.getByTestId("job-save-trigger").first()).toBeVisible();
  await expect(page.getByTestId("job-tracked-stage")).toHaveCount(0);
});

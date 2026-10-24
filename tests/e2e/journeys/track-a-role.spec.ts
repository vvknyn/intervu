import type { Route } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * "Track a role" for a signed-in account — see tests/journeys/CATALOG.md
 * (J-TRACKER-79). Signed in through the dev-only `window.__INTERVU_E2E_AUTH__`
 * hook (production builds ignore it), so it skips itself against any other
 * origin. Nothing is written: the save call is answered in the browser.
 */

const isLocal = (baseURL: string | undefined) => /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseURL ?? "http://localhost:3000");

/** Next server-action response in flight format: `1:` carries the action's return value. */
const flight = (value: unknown) => `0:{"a":"$@1","f":"","q":"","i":true,"b":"development"}\n1:D"$2"\n1:${JSON.stringify(value)}\n`;

/** The only fields a tracked role is created from; the server sets the rest (owner, dates, the résumé copy). */
const CREATE_FIELDS = ["company_name", "position", "job_url", "status", "note", "applied_at", "resume_version_id", "cover_letter"];

test.afterEach(({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));

test("Track a role as a signed-in account sends only the role's own fields; the server adds the owner, dates and any résumé copy", { tag: ["@J-TRACKER-79"] }, async ({ page, baseURL }) => {
  test.skip(!isLocal(baseURL), "signed-in tracking needs the dev-only __INTERVU_E2E_AUTH__ hook, which production builds ignore");
  const creates: string[] = [];
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__INTERVU_E2E_AUTH__ = { uid: "u1", email: "jane@example.com", displayName: "Jane Doe" };
    localStorage.setItem("intervu.onboarding.completed", "1");
  });
  await page.route(
    () => true,
    async (route: Route) => {
      const req = route.request();
      if (req.method() !== "POST" || !req.headers()["next-action"]) return route.continue();
      const body = req.postData() ?? "";
      if (!body.includes('"company_name"')) return route.continue();
      creates.push(body);
      const res = await route.fetch();
      return route.fulfill({ response: res, body: flight({ data: { id: "pursuit-journey-79" } }) });
    },
  );

  await page.goto("/yours?view=new");
  const sheet = page.getByRole("dialog", { name: "Track a role" });
  await expect(sheet).toBeVisible({ timeout: 30_000 });
  await sheet.getByPlaceholder("Acme").fill("Acme Payments");
  await sheet.getByPlaceholder("Staff Software Engineer").fill("Backend Engineer");
  await sheet.getByRole("button", { name: "Save to tracker" }).click();

  await expect.poll(() => creates.length, { timeout: 15_000 }).toBe(1);
  const sent = JSON.parse(creates[0])[0] as Record<string, unknown>;
  expect(sent).toMatchObject({ company_name: "Acme Payments", position: "Backend Engineer" });
  expect(Object.keys(sent).filter((k) => !CREATE_FIELDS.includes(k))).toEqual([]);
});

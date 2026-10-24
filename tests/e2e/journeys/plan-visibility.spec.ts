import type { Page, Route } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * Where an account sees its plan — see tests/journeys/CATALOG.md (J-BILLING-*).
 * The signed-in journeys sign in through the dev-only `window.__INTERVU_E2E_AUTH__`
 * hook (production builds ignore it), so they skip against any other origin; the
 * plan read is answered in the browser. Nothing is written.
 */

const isLocal = (baseURL: string | undefined) => /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseURL ?? "http://localhost:3000");

/** Next server-action response in flight format: `1:` carries the action's return value. */
const flight = (value: unknown) => `0:{"a":"$@1","f":"","q":"","i":true,"b":"development"}\n1:D"$2"\n1:${JSON.stringify(value)}\n`;

const DAY = 24 * 60 * 60 * 1000;

/** Signs in and answers the plan action (found by its guest reply, `{plan:{status:"free"}}`) with `reply`. */
async function signInWithPlan(page: Page, reply: unknown) {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__INTERVU_E2E_AUTH__ = { uid: "u1", email: "jane@example.com", displayName: "Jane Doe" };
    localStorage.setItem("intervu.onboarding.completed", "1");
  });
  await page.route(
    () => true,
    async (route: Route) => {
      const req = route.request();
      if (req.method() !== "POST" || !req.headers()["next-action"]) return route.continue();
      const res = await route.fetch();
      if (!(await res.text()).includes('"plan":{"status":"free"}')) return route.fulfill({ response: res });
      return route.fulfill({ response: res, body: flight(reply) });
    },
  );
}

test.afterEach(({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));

test("signed out, the header has a Pricing link that opens /pricing", { tag: ["@J-BILLING-01"] }, async ({ page, diagnostics }) => {
  await page.goto("/jobs");
  const link = page.getByTestId("topbar-pricing");
  await expect(link).toHaveAttribute("href", "/pricing");
  await link.click();
  await expect(page).toHaveURL(/\/pricing$/);
  expect(diagnostics.serverErrors).toEqual([]);
});

test("the footer on /jobs carries a Pricing link", { tag: ["@J-BILLING-02"] }, async ({ page }) => {
  await page.goto("/jobs");
  await expect(page.getByTestId("site-footer").getByRole("link", { name: "Pricing" }).first()).toHaveAttribute("href", "/pricing");
});

test("Settings shows the plan above the tabs: free, a gift, a paid end date, or an honest error", { tag: ["@J-BILLING-03"] }, async ({ page, baseURL }) => {
  test.skip(!isLocal(baseURL), "needs the dev-only __INTERVU_E2E_AUTH__ hook, which production builds ignore");
  const until = Date.UTC(2031, 0, 15);
  const cases: { reply: unknown; shows: RegExp; link: string; never?: RegExp }[] = [
    { reply: { plan: { status: "free" } }, shows: /^Free/, link: "See the paid month" },
    { reply: { plan: { status: "full", until, gift: true, endsSoon: false } }, shows: /Full access through Jan 15, 2031 — a gift, you weren't charged\./, link: "Add months" },
    { reply: { plan: { status: "full", until, gift: false, endsSoon: false } }, shows: /Full access through Jan 15, 2031$/, link: "Add months" },
    { reply: { error: "Couldn't load your plan" }, shows: /Couldn't load your plan\./, link: "See pricing", never: /Free/ },
  ];
  for (const c of cases) {
    await signInWithPlan(page, c.reply);
    await page.goto("/settings");
    const card = page.getByTestId("plan-card");
    await expect(card).toContainText(c.shows, { timeout: 30_000 });
    await expect(card.getByRole("link", { name: new RegExp(c.link) })).toHaveAttribute("href", "/pricing");
    if (c.never) await expect(card).not.toContainText(c.never);
    await page.unrouteAll({ behavior: "ignoreErrors" });
  }
});

test("the ending notice shows within 7 days of the end, stays off /pricing, and a dismissal holds for that end date", { tag: ["@J-BILLING-04"] }, async ({ page, baseURL }) => {
  test.skip(!isLocal(baseURL), "needs the dev-only __INTERVU_E2E_AUTH__ hook, which production builds ignore");
  const until = Date.now() + 3 * DAY;
  await signInWithPlan(page, { plan: { status: "full", until, gift: false, endsSoon: true } });
  await page.goto("/jobs");
  const notice = page.getByTestId("plan-ending-notice");
  await expect(notice).toContainText("Your full access ends", { timeout: 30_000 });
  await expect(notice.getByRole("link", { name: "Add months" })).toHaveAttribute("href", "/pricing");

  await page.goto("/pricing");
  await expect(page.getByTestId("pricing-page")).toBeVisible();
  await expect(notice).toHaveCount(0);

  await page.goto("/jobs");
  await notice.getByRole("button", { name: "Dismiss" }).click();
  await expect(notice).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("topbar")).toBeVisible();
  await expect(notice).toHaveCount(0);
});

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

/** Signs in and answers the plan action (found by its no-session reply, `{error:"no-session"}`) with `reply`. */
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
      if (!(await res.text()).includes('"error":"no-session"')) return route.fulfill({ response: res });
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
    { reply: { plan: { status: "full", until, gift: true, endsSoon: false } }, shows: /Full access through Jan 15, 2031 — a gift; you weren't charged for this time\./, link: "Add months" },
    { reply: { plan: { status: "full", until, gift: false, endsSoon: false } }, shows: /Full access through Jan 15, 2031(?! — a gift)/, link: "Add months" },
    { reply: { error: "Couldn't load your plan" }, shows: /Couldn't load your plan\./, link: "See pricing", never: /Free/ },
  ];
  for (const c of cases) {
    await signInWithPlan(page, c.reply);
    await page.goto("/mock/settings");
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

const row = (paidMs: number, label: string, amount: number, refunded: number, receiptUrl: string | null) => ({ paidMs, label, amount, refunded, currency: "usd", receiptUrl });
const PAYMENTS = [
  row(Date.UTC(2031, 0, 10), "Month to month", 600, 0, "https://pay.stripe.com/receipts/m2"),
  row(Date.UTC(2030, 11, 10), "3 months", 1800, 600, null),
  row(Date.UTC(2030, 5, 1), "1 month", 600, 600, "https://pay.stripe.com/receipts/a"),
];
const billing = (over: Record<string, unknown> = {}) => ({ payments: PAYMENTS, subscription: null, canManage: true, ...over });
const FREE = { status: "free" };

test("Settings › Account lists every payment, with refunds and receipts, or says there are none, or says it could not load", { tag: ["@J-BILLING-06"] }, async ({ page, baseURL }) => {
  test.skip(!isLocal(baseURL), "needs the dev-only __INTERVU_E2E_AUTH__ hook, which production builds ignore");

  await signInWithPlan(page, { plan: FREE, billing: billing() });
  await page.goto("/mock/settings?tab=account");
  const card = page.getByTestId("payments-card");
  const rows = card.getByTestId("payments-row");
  await expect(rows).toHaveCount(3, { timeout: 30_000 });
  await expect(rows.nth(0)).toContainText("Month to month");
  await expect(rows.nth(0)).toContainText("Jan 10, 2031");
  await expect(rows.nth(0)).toContainText("$6.00");
  await expect(rows.nth(0).getByRole("link", { name: "Receipt" })).toHaveAttribute("href", "https://pay.stripe.com/receipts/m2");
  await expect(rows.nth(1)).toContainText("3 months");
  await expect(rows.nth(1)).toContainText("$18.00");
  await expect(rows.nth(1)).toContainText("$6.00 refunded");
  await expect(rows.nth(1).getByRole("link", { name: "Receipt" })).toHaveCount(0);
  await expect(rows.nth(2)).toContainText("Refunded");
  await expect(card.getByTestId("payments-empty")).toHaveCount(0);
  await expect(card.getByTestId("payments-manage")).toBeVisible();

  await page.unrouteAll({ behavior: "ignoreErrors" });
  await signInWithPlan(page, { plan: FREE, billing: billing({ payments: [], canManage: false }) });
  await page.goto("/mock/settings?tab=account");
  await expect(page.getByTestId("payments-empty")).toHaveText("No payments yet.", { timeout: 30_000 });
  await expect(page.getByTestId("payments-manage")).toHaveCount(0);

  await page.unrouteAll({ behavior: "ignoreErrors" });
  await signInWithPlan(page, { plan: FREE, error: "Couldn't load your payments" });
  await page.goto("/mock/settings?tab=account");
  await expect(page.getByTestId("payments-error")).toContainText("can't load your payments", { timeout: 30_000 });
  await expect(page.getByTestId("payments-error-retry")).toBeVisible();
  await expect(page.getByTestId("payments-empty")).toHaveCount(0);
});

test("with month to month on, the plan and Payments say when the next payment is, when it ends, or that a charge failed, and Manage billing opens Stripe", { tag: ["@J-BILLING-07"] }, async ({ page, baseURL }) => {
  test.skip(!isLocal(baseURL), "needs the dev-only __INTERVU_E2E_AUTH__ hook, which production builds ignore");
  const until = Date.UTC(2031, 1, 10);
  const full = { status: "full", until, gift: false, endsSoon: false, autoRenew: true };
  const cases: { subscription: { state: string; periodEndMs: number }; says: RegExp }[] = [
    { subscription: { state: "renewing", periodEndMs: until }, says: /Month to month is on\. Next payment of \$6 on Feb 10, 2031\. Cancel any time\./ },
    { subscription: { state: "ending", periodEndMs: until }, says: /Month to month is cancelled\. Your access runs to Feb 10, 2031 and you won't be charged again\./ },
    { subscription: { state: "past_due", periodEndMs: until }, says: /last month-to-month payment didn't go through\. Update your card/ },
  ];
  for (const c of cases) {
    await signInWithPlan(page, { plan: full, billing: billing({ subscription: c.subscription }) });
    await page.goto("/mock/settings?tab=account");
    await expect(page.getByTestId("payments-subscription")).toHaveText(c.says, { timeout: 30_000 });
    const plan = page.getByTestId("plan-card");
    await expect(plan).toContainText("Full access, month to month — next payment Feb 10, 2031");
    await expect(plan).not.toContainText(/Add months/);
    await expect(plan.getByRole("link", { name: "Manage payments" })).toHaveAttribute("href", "/settings?tab=account");
    await page.unrouteAll({ behavior: "ignoreErrors" });
  }

  // Manage billing goes to wherever the portal route says; a refusal is shown, never a dead click.
  await signInWithPlan(page, { plan: full, billing: billing({ subscription: { state: "renewing", periodEndMs: until } }) });
  await page.route("**/api/billing/portal", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "The billing page isn't available right now. Try again later." }) }));
  await page.goto("/mock/settings?tab=account");
  await page.getByTestId("payments-manage").click({ timeout: 30_000 });
  await expect(page.getByTestId("payments-portal-error")).toContainText("isn't available right now");
  await page.unroute("**/api/billing/portal");
  await page.route("**/api/billing/portal", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: `${baseURL}/about` }) }));
  await page.getByTestId("payments-manage").click();
  await expect(page).toHaveURL(/\/about$/);
});

test("the account menu has one billing entry, Plan & payments, and it leads to the plan card with Payments right under it", { tag: ["@J-BILLING-05"] }, async ({ page, baseURL }) => {
  test.skip(!isLocal(baseURL), "needs the dev-only __INTERVU_E2E_AUTH__ hook, which production builds ignore");
  await signInWithPlan(page, { plan: FREE, billing: billing() });
  await page.goto("/jobs");
  await page.getByTestId("topbar-avatar").click({ timeout: 30_000 });
  await expect(page.getByRole("menuitem", { name: "Plan & pricing" })).toHaveCount(0);
  await expect(page.getByTestId("account-menu-plan")).toHaveText("Plan & payments");
  await expect(page.getByTestId("account-menu-plan")).toHaveAttribute("href", "/settings?tab=account");

  // Where it lands: the plan card above the tabs, then Payments, then the sign-in details.
  await page.keyboard.press("Escape");
  await page.goto("/mock/settings?tab=account");
  const plan = page.getByTestId("plan-card");
  const payments = page.getByTestId("payments-card");
  const signIn = page.getByRole("heading", { name: "Sign-in details" });
  await expect(payments.getByTestId("payments-row")).toHaveCount(3, { timeout: 30_000 });
  const [p, pay, sign] = await Promise.all([plan.boundingBox(), payments.boundingBox(), signIn.boundingBox()]);
  expect(p!.y).toBeLessThan(pay!.y);
  expect(pay!.y).toBeLessThan(sign!.y);
  // The way to buy is one click from there.
  await expect(plan.getByRole("link", { name: /See the paid month/ })).toHaveAttribute("href", "/pricing");
});

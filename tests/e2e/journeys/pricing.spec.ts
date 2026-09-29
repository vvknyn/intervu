import { expect, test } from "./fixtures";

/**
 * Journeys for /pricing — see tests/journeys/CATALOG.md (J-PRICING-*).
 * Read-only: nothing here reaches Stripe. The founding-seat button's target
 * depends on whether `FOUNDING_MEMBER_CHECKOUT_URL` is set on the server
 * under test, so J-PRICING-03 accepts either state and asserts the one that
 * is showing is well-formed (a real `https://buy.stripe.com/…` link, or the
 * email-only reservation form) — never a guessed URL. Nothing here submits
 * the reservation; that is J-PRICING-07 (uncovered: it needs a Firestore-
 * backed server and a throwaway inbox).
 */

const FOUNDING_SEAT_PRICE = "$49";
const FOUNDING_SEAT_COUNT = "100";

test("the pricing page shows three plans and the founding seat", { tag: ["@J-PRICING-01"] }, async ({ page, diagnostics }) => {
  await page.goto("/pricing");

  // Release 5 shipped the page behind a permanent /pricing → / redirect left in
  // next.config.ts by the 2026-08-27 billing removal; the page never rendered.
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(page.getByTestId("pricing-page")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Free while you search");

  const free = page.getByTestId("pricing-plan-free");
  const pro = page.getByTestId("pricing-plan-pro");
  const dataApi = page.getByTestId("pricing-plan-data-api");
  await expect(free).toContainText("$0");
  await expect(free).toContainText("Create free account");
  await expect(pro).toContainText(`${FOUNDING_SEAT_PRICE} once`);
  await expect(pro).toContainText(`First ${FOUNDING_SEAT_COUNT} seats`);
  await expect(pro).toContainText("Refundable on request");
  await expect(dataApi).toContainText("Tell us your use case");

  // The promise the whole page rests on, in the FAQ.
  await expect(page.getByText("Will anything I use today start costing money?")).toBeVisible();
  await expect(page.getByTestId("pricing-paid-banner")).toHaveCount(0);
  expect(diagnostics.serverErrors).toEqual([]);
});

test("the footer links to pricing from a marketing page", { tag: ["@J-PRICING-02"] }, async ({ page, diagnostics }) => {
  await page.goto("/about");

  const link = page.getByTestId("site-footer").getByRole("link", { name: "Pricing" });
  await expect(link).toHaveAttribute("href", "/pricing");
  await link.click();

  await expect(page).toHaveURL(/\/pricing$/);
  await expect(page.getByTestId("pricing-page")).toBeVisible();
  expect(diagnostics.serverErrors).toEqual([]);
});

test("the founding-seat button links to Stripe, or takes a reservation while unconfigured", { tag: ["@J-PRICING-03"] }, async ({ page, diagnostics }) => {
  await page.goto("/pricing");

  const cta = page.getByTestId("pricing-founding-cta");
  await expect(cta).toBeVisible();
  const href = await cta.getAttribute("href");
  const pro = page.getByTestId("pricing-plan-pro");
  // Search results and link previews read these, not the page body; release 8
  // fixed the body and left the description saying "open now".
  const description = page.locator('meta[name="description"]');
  const ogDescription = page.locator('meta[property="og:description"]');
  if (href) {
    expect(href).toMatch(/^https:\/\/buy\.stripe\.com\//);
    await expect(cta).toHaveText("Take a founding seat");
    await expect(pro).toContainText("Founding seats open");
    await expect(page.getByTestId("pricing-page")).toContainText("seats are open now");
    await expect(description).toHaveAttribute("content", /seats are open now/);
    await expect(ogDescription).toHaveAttribute("content", /seats are open now/);
  } else {
    // No Stripe link on this server: the Pro column takes an email
    // reservation instead of showing an inert button (release 9).
    await expect(cta).toBeEnabled();
    await expect(cta).toHaveText("Reserve a founding seat");
    await expect(page.getByTestId("pricing-founding-email")).toBeVisible();
    // The headline and badge must not promise what the button withholds
    // (release 7 said "open now" over an "open soon" button).
    await expect(pro).toContainText("Reservations open");
    await expect(page.getByTestId("pricing-page")).toContainText("seats open soon");
    await expect(page.getByTestId("pricing-page")).not.toContainText("are open now");
    await expect(description).toHaveAttribute("content", /seats open soon/);
    await expect(description).not.toHaveAttribute("content", /are open now/);
    await expect(ogDescription).toHaveAttribute("content", /seats open soon/);
  }
  expect(diagnostics.serverErrors).toEqual([]);
});

test("returning from Stripe shows the founding thank-you only with a session id", { tag: ["@J-PRICING-04"] }, async ({ page, diagnostics }) => {
  await page.goto("/pricing?checkout=success&session_id=cs_test_a1B2c3D4e5F6g7H8");
  await expect(page.getByTestId("pricing-paid-banner")).toContainText("You have a founding seat");

  await page.goto("/pricing?checkout=success");
  await expect(page.getByTestId("pricing-page")).toBeVisible();
  await expect(page.getByTestId("pricing-paid-banner")).toHaveCount(0);

  await page.goto("/pricing?checkout=success&session_id=not-a-stripe-id");
  await expect(page.getByTestId("pricing-page")).toBeVisible();
  await expect(page.getByTestId("pricing-paid-banner")).toHaveCount(0);
  expect(diagnostics.serverErrors).toEqual([]);
});

test("the Data API call to action leads to the contact form", { tag: ["@J-PRICING-05"] }, async ({ page, diagnostics }) => {
  await page.goto("/pricing");

  const cta = page.getByTestId("pricing-data-api-cta");
  await expect(cta).toHaveAttribute("href", "/contact?from=/pricing");
  await cta.click();

  await expect(page).toHaveURL(/\/contact\?from=%2Fpricing$|\/contact\?from=\/pricing$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(diagnostics.serverErrors).toEqual([]);
});

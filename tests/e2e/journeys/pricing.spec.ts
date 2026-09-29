import { expect, test } from "./fixtures";

/**
 * Journeys for /pricing — see tests/journeys/CATALOG.md (J-PRICING-*).
 * Read-only: nothing here reaches Stripe. The founding-seat button's target
 * depends on whether `FOUNDING_MEMBER_CHECKOUT_URL` is set on the server
 * under test, so J-PRICING-03 accepts either state and asserts the one that
 * is showing is well-formed (a real `https://buy.stripe.com/…` link, or an
 * inert "open soon" button) — never a guessed URL.
 */

const FOUNDING_SEAT_PRICE = "$49";
const FOUNDING_SEAT_COUNT = "100";

test("the pricing page shows three plans and the founding seat", { tag: ["@J-PRICING-01"] }, async ({ page, diagnostics }) => {
  await page.goto("/pricing");

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

test("the founding-seat button links to Stripe, or is inert while unconfigured", { tag: ["@J-PRICING-03"] }, async ({ page, diagnostics }) => {
  await page.goto("/pricing");

  const cta = page.getByTestId("pricing-founding-cta");
  await expect(cta).toBeVisible();
  const href = await cta.getAttribute("href");
  if (href) {
    expect(href).toMatch(/^https:\/\/buy\.stripe\.com\//);
    await expect(cta).toHaveText("Take a founding seat");
  } else {
    await expect(cta).toBeDisabled();
    await expect(cta).toHaveText("Founding seats open soon");
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

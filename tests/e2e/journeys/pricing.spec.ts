import { expect, test } from "./fixtures";

/**
 * Journeys for /pricing — see tests/journeys/CATALOG.md (J-PRICING-*).
 * Read-only: nothing here reaches Stripe. Whether the card shows the Buy
 * flow or "Payments open soon" depends on the server's Stripe config, so
 * J-PRICING-03 accepts either state and asserts the one showing is whole.
 */

test("the pricing page is one card with the monthly price and the refund promise", { tag: ["@J-PRICING-01"] }, async ({ page, diagnostics }) => {
  await page.goto("/pricing");

  await expect(page).toHaveURL(/\/pricing$/);
  await expect(page.getByTestId("pricing-page")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("One plan");

  const card = page.getByTestId("pricing-card");
  await expect(card).toContainText("$12");
  await expect(card).toContainText("1 to 12 months");
  await expect(card).toContainText("no auto-renew");
  await expect(card).toContainText("14-day refund");
  await expect(card).toContainText("Always free");
  await expect(card).toContainText("Each month adds");
  await expect(page.getByTestId("pricing-page")).not.toContainText(/founding|pledge/i);
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

test("the card offers sign-in-to-buy with a month picker, or says payments open soon, never a dead button", { tag: ["@J-PRICING-03"] }, async ({ page, diagnostics }) => {
  await page.goto("/pricing");

  const soon = page.getByTestId("pricing-soon");
  if ((await soon.count()) > 0) {
    await expect(soon).toHaveText("Payments open soon");
    await expect(page.getByTestId("pricing-months")).toHaveCount(0);
    await expect(page.getByTestId("pricing-sign-in")).toHaveCount(0);
  } else {
    await expect(page.getByTestId("pricing-sign-in")).toHaveAttribute("href", "/auth/start?next=/pricing");
    await page.getByTestId("pricing-months").selectOption("3");
    await expect(page.getByTestId("pricing-total")).toContainText("$36");
  }
  // Search results and link previews read these, not the page body.
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /\$12/);
  await expect(page.locator('meta[property="og:description"]')).toHaveAttribute("content", /\$12/);
  expect(diagnostics.serverErrors).toEqual([]);
});

test("pricing offers no data sale or licence", { tag: ["@J-PRICING-04"] }, async ({ page, diagnostics }) => {
  await page.goto("/pricing");

  await expect(page.getByTestId("pricing-page")).toBeVisible();
  await expect(page.getByTestId("pricing-page")).not.toContainText(/Data API|licens/i);
  expect(diagnostics.serverErrors).toEqual([]);
});

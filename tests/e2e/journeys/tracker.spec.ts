import { expect, test } from "./fixtures";

/**
 * Tracker journeys — see tests/journeys/CATALOG.md (J-TRACKER-*). These seed
 * a guest pursuit in localStorage before the first load, the way the legacy
 * yours.spec.ts does, so nothing here needs an account or the server store.
 *
 * J-TRACKER-48/49/50 cover the pay-it-forward moment (strategy decision 7): a
 * pursuit in the Offer lane shows the pledge panel. Its button depends on
 * whether `LANDED_PLEDGE_CHECKOUT_URL` is set on the server under test, so
 * the tests accept either state and assert the one showing is well-formed
 * (a real `https://buy.stripe.com/…` link, or the contact-page link).
 */

const GUEST_PURSUITS_KEY = "intervu.pursuits.guest";

function guestPursuit(status: "offer" | "applied") {
  const now = new Date().toISOString();
  return {
    id: `guest-journey-${status}`,
    user_id: "guest",
    company_name: "Acme Corp",
    position: "Staff Engineer",
    status,
    job_id: "job-journey-1",
    job_snapshot: {
      title: "Staff Engineer",
      company: "Acme Corp",
      location: "Remote",
      description: "Build things.",
      apply_url: "https://example.com/jobs/1",
    },
    created_at: now,
    updated_at: now,
  };
}

async function seedGuestPursuit(page: import("@playwright/test").Page, status: "offer" | "applied") {
  await page.addInitScript(
    ([key, seed]) => {
      localStorage.setItem(key as string, JSON.stringify([seed]));
    },
    [GUEST_PURSUITS_KEY, guestPursuit(status)] as const,
  );
}

async function expectPledgePanel(scope: import("@playwright/test").Locator) {
  const panel = scope.getByTestId("landed-pledge");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Offer in hand");
  const pay = panel.getByTestId("landed-pledge-pay");
  if (await pay.count()) {
    await expect(pay).toHaveAttribute("href", /^https:\/\/buy\.stripe\.com\//);
    await expect(pay).toHaveText("Pay it forward");
  } else {
    const tell = panel.getByTestId("landed-pledge-tell");
    await expect(tell).toHaveAttribute("href", "/contact?from=/yours");
    await expect(panel).not.toContainText("Pay it forward");
  }
}

test("a pursuit in the Offer lane shows the pay-it-forward panel in the detail sheet", { tag: ["@J-TRACKER-48"] }, async ({ page, diagnostics }) => {
  await seedGuestPursuit(page, "offer");
  // Below xl a row click opens the sheet; at xl+ it navigates to the full
  // page (J-TRACKER-50). Playwright's default 1280 wide IS the xl boundary.
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/yours");

  await page.getByTestId("pursuit-row").first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 10000 });
  await expect(dialog).toContainText("Staff Engineer");
  await expectPledgePanel(dialog);
  expect(diagnostics.serverErrors).toEqual([]);
});

test("a pursuit that has not reached an offer shows no pledge panel", { tag: ["@J-TRACKER-49"] }, async ({ page, diagnostics }) => {
  await seedGuestPursuit(page, "applied");
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/yours");

  await page.getByTestId("pursuit-row").first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 10000 });
  await expect(dialog).toContainText("Staff Engineer");
  await expect(dialog.getByTestId("landed-pledge")).toHaveCount(0);
  expect(diagnostics.serverErrors).toEqual([]);
});

test("the full pursuit page shows the pay-it-forward panel for an offer", { tag: ["@J-TRACKER-50"] }, async ({ page, diagnostics }) => {
  await seedGuestPursuit(page, "offer");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/yours");

  await page.getByTestId("pursuit-row").first().click();
  await expect(page).toHaveURL("/yours/guest-journey-offer");
  await expect(page.getByTestId("pursuit-stage")).toBeVisible({ timeout: 10000 });
  const main = page.getByRole("main");
  await expectPledgePanel(main);
  // The panel carries the moment; the next-action card must not repeat it
  // as a bare "You have an offer" line underneath.
  await expect(main).not.toContainText("You have an offer");
  expect(diagnostics.serverErrors).toEqual([]);
});

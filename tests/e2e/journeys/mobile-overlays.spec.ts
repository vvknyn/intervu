import { expect, test } from "./fixtures";
import { filtersToggle, openGroup, showFilters } from "./filters-panel";
import { settled } from "./overlay";

/**
 * Overlay primitives at compact width — see tests/journeys/CATALOG.md (J-MODAL-07, J-MODAL-08).
 * The Filters are a bottom sheet with 44px rows on a phone and a rail on a laptop;
 * a Dialog is a full-width sheet on the bottom edge that never starts above y=0.
 */

test("the Filters sheet is a full-width bottom sheet with 44px rows on a phone, and a rail beside the list at laptop width", { tag: ["@J-MODAL-07"] }, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/jobs");
  const toggle = filtersToggle(page);
  await showFilters(page);
  const sheet = page.getByRole("dialog", { name: "Filters" });
  await expect(sheet).toBeVisible();
  await settled(sheet);
  const box = (await sheet.boundingBox())!;
  expect(box.x, "the sheet spans the screen").toBe(0);
  expect(box.width).toBe(390);
  expect(box.y + box.height, "the sheet sits on the bottom edge").toBe(844);
  // Minimum salary is on every search, whatever the index returns for the other groups.
  const row = (await openGroup(sheet.getByTestId("filters-panel"), "salary")).locator("label").first();
  expect((await row.boundingBox())!.height, "rows meet the 44px touch floor").toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(toggle, "focus returns to the Filters button").toBeFocused();

  // At laptop width the same filters are a panel in the page, not an overlay.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/jobs?q=software+engineer");
  await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("filters-rail")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("a Dialog is a full-width bottom sheet on a phone and stays below y=0 when the keyboard shrinks the viewport", { tag: ["@J-MODAL-08"] }, async ({ page, baseURL }) => {
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseURL ?? "http://localhost:3000");
  test.skip(!local, "the account menu needs the dev-only __INTERVU_E2E_AUTH__ sign-in, which production builds ignore");
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__INTERVU_E2E_AUTH__ = {
      uid: "u1", displayName: "Ada Lovelace", email: "ada@example.com", emailVerified: true, isAnonymous: false,
      providerData: [], metadata: {}, photoURL: null, phoneNumber: null, providerId: "password", tenantId: null, refreshToken: "x",
    };
  });
  await page.setViewportSize({ width: 390, height: 470 });
  await page.goto("/resume");
  const feedback = page.getByRole("menuitem", { name: "Feedback" });
  const dialog = page.getByRole("dialog", { name: "Send Feedback" });
  await expect(async () => {
    if (await dialog.isVisible()) return;
    if (!(await feedback.isVisible())) await page.getByTestId("topbar-avatar").click({ timeout: 2_000 });
    await feedback.click({ timeout: 2_000 });
    await expect(dialog).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await settled(dialog);
  const box = (await dialog.boundingBox())!;
  expect(box.width, "full width").toBe(390);
  expect(box.y, "never starts above the screen").toBeGreaterThanOrEqual(0);
  expect(box.y + box.height, "anchored to the bottom edge").toBe(470);
});

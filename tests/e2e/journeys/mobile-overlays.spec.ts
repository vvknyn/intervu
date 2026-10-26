import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { settled } from "./overlay";

/**
 * Overlay primitives at compact width — see tests/journeys/CATALOG.md (J-MODAL-08).
 * A choice list is a bottom sheet with 44px rows on a phone and a popover on desktop;
 * a Dialog is a full-width sheet on the bottom edge that never starts above y=0.
 */

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

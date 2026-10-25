import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { settled } from "./overlay";

/**
 * Overlay primitives at compact width — see tests/journeys/CATALOG.md (J-MODAL-07, J-MODAL-08).
 * A choice list is a bottom sheet with 44px rows on a phone and a popover on desktop;
 * a Dialog is a full-width sheet on the bottom edge that never starts above y=0.
 */

/** Picking a single-select row applies it and closes the list (native select, iOS sheet, Material menu), focus back on the chip. */
async function expectPickClosesAndRefocuses(page: Page, list: Locator) {
  const chip = page.getByTestId("facet-chip-posted");
  const before = await chip.innerText();
  await chip.click();
  await expect(list).toBeVisible();
  await settled(list);
  // Not "Any date": clearing the date drops the Posted chip itself.
  await list.locator("label:has(input[type=radio]:not(:checked))").filter({ hasNotText: "Any date" }).first().click();
  await expect(list, "the pick closes the list").toHaveCount(0);
  await expect(chip, "focus returns to the chip").toBeFocused();
  expect(await chip.innerText(), "the pick was applied").not.toBe(before);
}

test("a facet chip opens a bottom sheet with 44px rows on a phone and a popover on desktop", { tag: ["@J-MODAL-07"] }, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/jobs");
  await page.getByTestId("facet-chip-posted").click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await settled(sheet);
  const box = (await sheet.boundingBox())!;
  expect(box.x, "the sheet spans the screen").toBe(0);
  expect(box.width).toBe(390);
  expect(box.y + box.height, "the sheet sits on the bottom edge").toBe(844);
  const row = sheet.locator("label").first();
  expect((await row.boundingBox())!.height, "rows meet the 44px touch floor").toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expectPickClosesAndRefocuses(page, sheet);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId("facet-chip-posted").click();
  // Radix gives a popover the dialog role too, so tell them apart by shape.
  const popover = page.getByRole("dialog");
  await expect(popover).toBeVisible();
  await settled(popover);
  const desktop = (await popover.boundingBox())!;
  expect(desktop.width, "desktop keeps the 224px popover").toBeLessThan(300);
  expect(desktop.y + desktop.height, "beside the chip, not on the screen's bottom edge").toBeLessThan(900);
  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  await expectPickClosesAndRefocuses(page, popover);
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

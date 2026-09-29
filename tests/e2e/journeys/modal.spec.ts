import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * Journeys for the shared overlay primitive (ui/dialog + ui/sheet) — see tests/journeys/CATALOG.md (J-MODAL-*).
 * Read-only: the résumé is parsed in the browser and never leaves it.
 */

const VIEWPORTS = [
  { name: "1280x600", width: 1280, height: 600 },
  { name: "390x844", width: 390, height: 844 },
  // A phone with the software keyboard open leaves about this much layout viewport.
  { name: "390x420", width: 390, height: 420 },
];

const COMPANIES = ["Acme Robotics", "Northwind Labs", "Globex Systems", "Initech Cloud", "Umbrella Data", "Hooli Search", "Stark Analytics"];

/** A plain-text résumé with 7 dated roles: enough that the review step overflows a 600px-tall viewport. */
const RESUME_TEXT = [
  "Jordan Rivera",
  "Senior Software Engineer",
  "jordan.rivera@example.com | Toronto, ON",
  "",
  "EXPERIENCE",
  ...COMPANIES.flatMap((company, i) => [
    `Software Engineer, ${company}`,
    `${2024 - i * 2} - ${2026 - i * 2}`,
    `- Built and shipped services used by ${i + 2} product teams.`,
    `- Reduced p95 latency by ${10 + i}% across the platform.`,
    "",
  ]),
  "EDUCATION",
  "B.Sc. Computer Science, University of Waterloo, 2012",
  "",
  "SKILLS",
  "TypeScript, React, Node.js, PostgreSQL, Kubernetes",
].join("\n");

const dialogBody = (dialog: Locator) => dialog.locator('[data-slot="dialog-body"]');

/** Box of the element sits fully inside the viewport (no pixel of it unreachable). */
async function expectInViewport(page: Page, el: Locator) {
  const box = await el.boundingBox();
  const vh = page.viewportSize()!.height;
  expect(box, "element has a box").not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(vh + 1);
}

/**
 * Scroll like a user (wheel over the dialog), never `scrollIntoView`: that also moves `overflow:hidden`
 * boxes, which is exactly how a clipped modal passes a programmatic check. The target must end fully
 * visible, above the pinned footer (if any), inside the viewport.
 */
async function wheelRevealsAboveFooter(page: Page, dialog: Locator, target: Locator, footer: Locator | null) {
  const vh = page.viewportSize()!.height;
  // Wheel events aimed at a still-animating dialog land on stale coordinates.
  await dialog.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
  const dialogBox = (await dialog.boundingBox())!;
  await page.mouse.move(dialogBox.x + dialogBox.width / 2, dialogBox.y + dialogBox.height / 2);
  const revealed = async () => {
    const [box, footerBox] = await Promise.all([target.boundingBox(), footer?.boundingBox()]);
    return !!box && box.y >= 0 && box.y + box.height <= Math.min(footerBox?.y ?? vh, vh) + 1;
  };
  for (let i = 0; i < 60 && !(await revealed()); i++) {
    await page.mouse.wheel(0, 250);
    await page.waitForTimeout(40);
  }
  expect(await revealed(), "target reachable by wheel-scrolling, above the footer, inside the viewport").toBe(true);
}

for (const vp of VIEWPORTS) {
  test(`résumé import modal scrolls to the last experience entry at ${vp.name}`, { tag: ["@J-MODAL-01"] }, async ({ page, diagnostics }) => {
    await page.setViewportSize(vp);
    await page.goto("/resume");
    await page.getByTestId("resume-signed-out-upload").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Input step: the dialog fits the viewport and its footer buttons are reachable.
    await expectInViewport(page, dialog);
    await expect(dialog.getByTestId("resume-import-parse-primary")).toBeInViewport();

    await dialog.locator('input[type="file"]').setInputFiles({ name: "resume.txt", mimeType: "text/plain", buffer: Buffer.from(RESUME_TEXT) });
    await dialog.getByTestId("resume-import-skip-download").click();
    await dialog.getByTestId("resume-import-parse-primary").click();

    // Located by the parsed values, not by review-step markup (which another change owns).
    const back = dialog.getByRole("button", { name: "Back" }); // the review step's footer
    await expect(back).toBeVisible({ timeout: 30_000 });
    const fields = dialog.locator("input, textarea");
    const companyFieldIndexes = await fields.evaluateAll((els, companies) => {
      const firstIndexPerCompany = companies.map((c) => els.findIndex((el) => (el as HTMLInputElement).value.includes(c)));
      return firstIndexPerCompany.filter((i) => i >= 0);
    }, COMPANIES);
    expect(companyFieldIndexes.length, "fixture yields at least 6 experience entries").toBeGreaterThanOrEqual(6);
    const lastEntry = fields.nth(Math.max(...companyFieldIndexes));

    const confirm = dialog.locator('[data-slot="dialog-footer"]').getByRole("button").last();
    const pageScrollBefore = await page.evaluate(() => window.scrollY);
    const body = dialogBody(dialog);
    const overflow = await body.evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(overflow, "body overflows, so this run really exercises scrolling").toBeGreaterThan(0);
    await wheelRevealsAboveFooter(page, dialog, lastEntry, back);
    // ...and the last field of the body (below Experience) is reachable too.
    await wheelRevealsAboveFooter(page, dialog, body.locator("input, textarea").last(), back);
    await expectInViewport(page, dialog);
    await expect(back).toBeInViewport();
    await expect(confirm).toBeInViewport();

    // The page behind does not scroll while the modal body does.
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe("hidden");
    expect(await page.evaluate(() => window.scrollY), "no scroll bleed to the page").toBe(pageScrollBefore);

    // Clickable, not just visible: Back returns to the input step.
    await back.click();
    await expect(dialog.getByTestId("resume-import-parse-primary")).toBeVisible();
    expect(diagnostics.pageErrors).toEqual([]);
  });
}

for (const vp of VIEWPORTS) {
  test(`sign-in dialog fits ${vp.name} and its last control is reachable by scrolling`, { tag: ["@J-MODAL-02"] }, async ({ page, diagnostics }) => {
    await page.setViewportSize(vp);
    await page.goto("/resume");
    await page.getByTestId("topbar-signin").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expectInViewport(page, dialog);

    await wheelRevealsAboveFooter(page, dialog, dialog.getByRole("button", { name: "Forgot password?" }), null);
    await expectInViewport(page, dialog);
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe("hidden");

    // Clickable, and the close control still dismisses it.
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();
    expect(diagnostics.pageErrors).toEqual([]);
  });
}

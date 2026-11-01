import type { Page } from "@playwright/test";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { LOOK_STORAGE_KEY } from "../../../src/lib/ui/look";
import { expect, test } from "./fixtures";
import { isLocalOrigin, SIGNED_IN_SKIP_REASON } from "./signed-in";

/**
 * The look switch (src/lib/ui/look.ts): the glass look (iOS 27 on a phone,
 * macOS 27 on a computer) and the classic look it can be switched back to.
 * See tests/journeys/CATALOG.md (J-LOOK-01..03). Read-only: the choice lives
 * in localStorage.
 */

const SEARCH = "/jobs?q=product%20manager&posted=any";

const returningVisitor = (page: Page) =>
    page.addInitScript((key) => localStorage.setItem(key, "1"), ONBOARDING_COMPLETED_STORAGE_KEY);

/** Waits for the first rows, if this server's search answers at all. */
const rowsIfAny = (page: Page) =>
    page.getByTestId("job-row").first().waitFor({ timeout: 20_000 }).then(
        () => true,
        () => false,
    );

const panelRadius = (page: Page) =>
    page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--panel-radius").trim());

/**
 * Opens one floating surface and returns its paint: the job sheet on a phone,
 * the Sort menu on a computer. Both are the navigation layer the glass applies to.
 */
async function floatingSurfacePaint(page: Page, phone: boolean) {
    if (phone) {
        await page.getByTestId("job-row").first().click();
        const sheet = page.getByRole("dialog").first();
        await expect(sheet).toBeVisible({ timeout: 10_000 });
        return sheet.evaluate((el) => {
            const s = getComputedStyle(el);
            return { backdrop: s.backdropFilter, background: s.backgroundColor, radius: s.borderTopLeftRadius };
        });
    }
    await page.getByRole("button", { name: "Sort", exact: true }).first().click();
    const option = page.getByText("Freshest", { exact: true }).first();
    await expect(option).toBeVisible({ timeout: 10_000 });
    return option.evaluate((el) => {
        let panel: Element | null = el;
        while (panel && !panel.matches('[data-slot$="-content"], [data-radix-popper-content-wrapper] > *')) panel = panel.parentElement;
        const s = getComputedStyle(panel ?? el);
        return { backdrop: s.backdropFilter, background: s.backgroundColor, radius: s.borderTopLeftRadius };
    });
}

test("By default the site wears the glass look: big corners on a phone, macOS's tighter corner on a computer, and the job sheet or Sort menu is translucent glass", { tag: ["@J-LOOK-01"] }, async ({ page }, testInfo) => {
    const phone = testInfo.project.name === "mobile";
    returningVisitor(page);
    await page.goto(SEARCH);
    await expect(page.locator("html")).toHaveAttribute("data-look", "glass");
    expect(await panelRadius(page)).toBe(phone ? "28px" : "12px");
    test.skip(!(await rowsIfAny(page)), "this server's search returned no rows");
    const paint = await floatingSurfacePaint(page, phone);
    expect(paint.backdrop).toContain("blur(24px)");
    // Translucent, not a solid fill: rgba with alpha below 1.
    expect(paint.background).toMatch(/^rgba\(.*, 0\.\d+\)$/);
});

test("?look=classic turns the glass off, and the choice holds on the next visit without the query", { tag: ["@J-LOOK-02"] }, async ({ page }, testInfo) => {
    const phone = testInfo.project.name === "mobile";
    returningVisitor(page);
    await page.goto(`${SEARCH}&look=classic`);
    await expect(page.locator("html")).toHaveAttribute("data-look", "classic");
    expect(await page.evaluate((key) => localStorage.getItem(key), LOOK_STORAGE_KEY)).toBe("classic");
    await page.goto(SEARCH);
    await expect(page.locator("html")).toHaveAttribute("data-look", "classic");
    expect(await panelRadius(page)).toBe("16px");
    test.skip(!(await rowsIfAny(page)), "this server's search returned no rows");
    const paint = await floatingSurfacePaint(page, phone);
    expect(paint.backdrop).toBe("none");
    expect(paint.background).toMatch(/^rgb\(/);
});

test("Settings › Account › Glass look switches the look off and on in place, and the choice holds after a reload (dev-server only: signed-in mock)", { tag: ["@J-LOOK-03"] }, async ({ page, baseURL }) => {
    test.skip(!isLocalOrigin(baseURL), SIGNED_IN_SKIP_REASON);
    await page.goto("/mock/settings?tab=account");
    const toggle = page.getByRole("switch", { name: "Glass look" });
    await expect(toggle).toBeVisible({ timeout: 15_000 });
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-look", "classic");
    await expect(toggle).not.toBeChecked();
    await page.reload();
    await expect(page.getByRole("switch", { name: "Glass look" })).not.toBeChecked({ timeout: 15_000 });
    await expect(page.locator("html")).toHaveAttribute("data-look", "classic");
    await page.getByRole("switch", { name: "Glass look" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-look", "glass");
});

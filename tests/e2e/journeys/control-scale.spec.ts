import type { Locator, Page } from "@playwright/test";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { expect, test } from "./fixtures";

/**
 * Journeys for the control-height scale (globals.css `--control-h-sm|md|lg`):
 * controls that share a row share one step, at every width. The 44px touch
 * target is an invisible hit area, so the visual height is the same on a phone.
 * See tests/journeys/CATALOG.md (J-NAV-07, J-NAV-33, J-NAV-34, J-JOBS-29, J-JOBS-30). Read-only.
 */

const MD = 32;
const LG = 44;

const CONTROLS = 'button, input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), select, [role="tab"]';

/** Rendered heights of the row's visible controls matching `selector`, whole px. */
const controlHeights = (row: Locator, selector = CONTROLS) =>
    row
        .locator(selector)
        .evaluateAll((els) =>
            els
                .map((el) => el.getBoundingClientRect())
                .filter((r) => r.width > 0 && r.height > 0)
                .map((r) => Math.round(r.height)),
        );

const returningVisitor = (page: Page) =>
    page.addInitScript((key) => localStorage.setItem(key, "1"), ONBOARDING_COMPLETED_STORAGE_KEY);

for (const path of ["/jobs", "/trends", "/about"]) {
    test(`signed-out header on ${path}: one Sign in and one Create account, both on the md step`, { tag: ["@J-NAV-07", "@J-NAV-33"] }, async ({ page }) => {
        await page.goto(path);
        const signIn = page.getByTestId("topbar-signin");
        const create = page.getByTestId("topbar-create-account");
        await expect(signIn).toHaveCount(1);
        await expect(create).toHaveCount(1);
        await expect(signIn).toBeVisible({ timeout: 15_000 });
        const heights = await Promise.all([signIn, create].map(async (l) => Math.round((await l.boundingBox())!.height)));
        expect(heights).toEqual([MD, MD]);
    });
}

test("desktop header with a query: the docked search, Sign in and Create account share the md step", { tag: ["@J-NAV-33"] }, async ({ page, isMobile }) => {
    test.skip(isMobile, "the search docks into the header at lg and up only");
    await returningVisitor(page);
    await page.goto("/jobs?q=data+analyst");
    const row = ["topbar-docked-search", "topbar-signin", "topbar-create-account"].map((id) => page.getByTestId(id));
    for (const l of row) await expect(l).toBeVisible({ timeout: 15_000 });
    const heights = await Promise.all(row.map(async (l) => Math.round((await l.boundingBox())!.height)));
    expect(heights).toEqual([MD, MD, MD]);
});

test("/jobs search row: query, location and Search share the lg step", { tag: ["@J-JOBS-29"] }, async ({ page }) => {
    await returningVisitor(page);
    await page.goto("/jobs");
    const row = page.locator("[data-search-line]");
    await expect(row.getByTestId("search-submit")).toBeVisible({ timeout: 15_000 });
    // The inline clear glyphs sit inside the fields on the sm step; every other control is the row.
    await expect.poll(() => controlHeights(row, `:is(${CONTROLS}):not([data-testid$="-clear"])`)).toEqual([LG, LG, LG]);
});

test("/jobs toolbar: every control in the row takes the md step", { tag: ["@J-JOBS-30"] }, async ({ page }) => {
    await returningVisitor(page);
    await page.goto("/jobs");
    const row = page.getByTestId("jobs-toolbar-scroller");
    await expect(row.getByTestId("filters-toggle")).toBeVisible({ timeout: 15_000 });
    const heights = await controlHeights(row);
    expect(heights.length).toBeGreaterThanOrEqual(2);
    expect(new Set(heights)).toEqual(new Set([MD]));
});

/**
 * Class-wide: every flex row on the page, not just the named ones. Controls are
 * grouped by their nearest flex-row ancestor; a group with more than one height
 * is a row that mixes steps. The one structural exception is a sm-step glyph in
 * a row that holds a text field (the field's own clear/dismiss affordance).
 */
for (const path of ["/jobs", "/jobs?q=data+analyst", "/trends", "/about"]) {
    test(`no row on ${path} mixes control steps`, { tag: ["@J-NAV-34"] }, async ({ page }) => {
        await returningVisitor(page);
        await page.goto(path);
        await expect(page.getByTestId("topbar-signin")).toBeVisible({ timeout: 15_000 });
        const mixed = await page.evaluate((sel) => {
            const SM = 24;
            const groups = new Map<Element, Element[]>();
            for (const el of document.querySelectorAll(sel)) {
                const r = el.getBoundingClientRect();
                if (r.width === 0 || r.height === 0) continue;
                let row = el.parentElement;
                while (row && !(getComputedStyle(row).display.includes("flex") && getComputedStyle(row).flexDirection === "row")) row = row.parentElement;
                if (row) groups.set(row, [...(groups.get(row) ?? []), el]);
            }
            return [...groups.values()]
                .map((els) => {
                    const hasField = els.some((e) => e.tagName === "INPUT");
                    return els
                        .map((e) => ({ e, h: Math.round(e.getBoundingClientRect().height) }))
                        .filter(({ h }) => !(hasField && h === SM))
                        .map(({ e, h }) => `${(e as HTMLElement).dataset.testid ?? e.getAttribute("aria-label") ?? e.tagName}=${h}`);
                })
                .filter((row) => new Set(row.map((c) => c.split("=").pop())).size > 1);
        }, CONTROLS);
        expect(mixed).toEqual([]);
    });
}

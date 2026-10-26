import type { Page } from "@playwright/test";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { expect, test } from "./fixtures";

/**
 * Journeys for the page scale (docs/design-language.md §3, §6): one page
 * container on the header's edge, one page-title step, and control rows that
 * wrap without stranding their last control. At 1440 and 390 (the two
 * projects), and 375, 360 and 320 for the phone toolbar. See tests/journeys/CATALOG.md
 * (J-NAV-35, J-NAV-36, J-NAV-37, J-NAV-41). Read-only.
 */

const PAGE_TITLE_PX = "28px";

const returningVisitor = (page: Page) =>
    page.addInitScript((key) => localStorage.setItem(key, "1"), ONBOARDING_COMPLETED_STORAGE_KEY);

/**
 * Class-wide: every visible row that wraps its items (a `flex-wrap` row or a
 * `.wrap-row`), not just the /jobs toolbar that surfaced this. A row strands a
 * control when its last line holds one control and the line above holds two
 * or more.
 */
const strandedControls = (page: Page) =>
    page.evaluate(() => {
        const CONTROL = "button, a, input, select, [role=button], [role=tab]";
        const visible = (e: Element) => {
            const r = e.getBoundingClientRect();
            return r.width > 1 && r.height > 1 && getComputedStyle(e).visibility !== "hidden";
        };
        const out: string[] = [];
        for (const row of document.querySelectorAll("body *")) {
            const cs = getComputedStyle(row);
            const wraps = row.classList.contains("wrap-row") || (cs.display.includes("flex") && cs.flexDirection === "row" && cs.flexWrap === "wrap");
            if (!wraps || !visible(row)) continue;
            const controls = [...row.querySelectorAll(CONTROL)].filter((c) => visible(c) && !c.parentElement?.closest(CONTROL));
            if (controls.length < 3) continue;
            const lines: Element[][] = [];
            const mids: number[] = [];
            for (const c of controls) {
                const r = c.getBoundingClientRect();
                const mid = r.top + r.height / 2;
                const i = mids.findIndex((m) => Math.abs(m - mid) < 12);
                if (i >= 0) {
                    lines[i].push(c);
                } else {
                    mids.push(mid);
                    lines.push([c]);
                }
            }
            const order = mids.map((m, i) => [m, i]).sort((a, b) => a[0] - b[0]).map(([, i]) => lines[i]);
            const [prev, last] = order.slice(-2);
            if (order.length >= 2 && last.length === 1 && prev.length >= 2) {
                const c = last[0] as HTMLElement;
                out.push(`${(row as HTMLElement).dataset.testid ?? row.className} :: ${c.dataset.testid ?? c.getAttribute("aria-label") ?? c.textContent?.trim()}`);
            }
        }
        return out;
    });

/** Opens `path` as a returning visitor once the board (and its toolbar "?") is up. */
async function openBoard(page: Page, path: string) {
    await returningVisitor(page);
    await page.goto(path);
    await expect(page.getByTestId("topbar-signin")).toBeVisible({ timeout: 15_000 });
    // The board mounts after hydration and can land after the header's
    // sign-in link; measuring before it did is how a stranded "?" on the
    // phone toolbar went unseen. The "?" sits in the board's toolbar.
    await expect(page.getByTestId("jobs-tour-replay").first()).toBeVisible({ timeout: 15_000 });
}

for (const path of ["/", "/jobs", "/jobs?q=engineer"]) {
    test(`no wrapping row on ${path} strands its last control on a line of its own`, { tag: ["@J-NAV-35"] }, async ({ page }) => {
        await openBoard(page, path);
        expect(await strandedControls(page)).toEqual([]);
    });
}

// The mobile project is 390 wide; the common narrower phones are 375 and 360,
// and 320 is the narrowest still in use. There the toolbar fits because it is
// one Filters pill plus a sideways-scrolling chip row.
for (const width of [375, 360, 320]) {
    for (const path of ["/jobs", "/jobs?q=engineer"]) {
        test(`on a ${width}px phone no wrapping row on ${path} strands its last control`, { tag: ["@J-NAV-41"] }, async ({ page }, testInfo) => {
            test.skip(testInfo.project.name !== "mobile", "a phone width");
            await page.setViewportSize({ width, height: 800 });
            await openBoard(page, path);
            // One "Filters" pill is the only filter entry; the chip row scrolls sideways.
            await expect(page.getByTestId("filters-toggle")).toBeVisible();
            expect(await strandedControls(page)).toEqual([]);
        });
    }
}

// The page's column (its `<name>-page` PageContainer) — the legal pages set
// their document in a bordered card inside it, so the column, not the h1, is
// what lines up with the logo.
for (const name of ["about", "privacy", "terms", "contact"]) {
    test(`/${name}: the page column starts on the header logo's left edge`, { tag: ["@J-NAV-36"] }, async ({ page }) => {
        await page.goto(`/${name}`);
        const boxes = [page.getByTestId("topbar-logo"), page.getByTestId(`${name}-page`)];
        for (const l of boxes) await expect(l).toBeVisible({ timeout: 15_000 });
        // Polled: the header settles its auth slot after first paint.
        await expect
            .poll(async () => {
                const [logoX, columnX] = await Promise.all(boxes.map(async (l) => Math.round((await l.boundingBox())?.x ?? NaN)));
                return columnX - logoX;
            })
            .toBe(0);
    });
}

for (const path of ["/", "/about", "/privacy", "/yours", "/login"]) {
    test(`${path}: every visible h1 is on the page-title step`, { tag: ["@J-NAV-37"] }, async ({ page }) => {
        await returningVisitor(page);
        await page.goto(path);
        // Distinct sizes of the visible h1s (an sr-only h1 is 1px wide and has no visual size).
        await expect
            .poll(
                () =>
                    page.locator("h1").evaluateAll((els) => [
                        ...new Set(els.filter((e) => e.getBoundingClientRect().width > 1).map((e) => getComputedStyle(e).fontSize)),
                    ]),
                { timeout: 15_000 },
            )
            .toEqual([PAGE_TITLE_PX]);
    });
}

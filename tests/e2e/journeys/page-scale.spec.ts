import type { Page } from "@playwright/test";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { expect, test } from "./fixtures";

/**
 * Journeys for the page scale (docs/design-language.md §3, §6): one page
 * container on the header's edge, one page-title step, and control rows that
 * wrap without stranding their last control. At 1440 and 390 (the two
 * projects). See tests/journeys/CATALOG.md (J-NAV-35, J-NAV-36, J-NAV-37). Read-only.
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
for (const path of ["/", "/jobs", "/jobs?q=engineer"]) {
    test(`no wrapping row on ${path} strands its last control on a line of its own`, { tag: ["@J-NAV-35"] }, async ({ page }) => {
        await returningVisitor(page);
        await page.goto(path);
        await expect(page.getByTestId("topbar-signin")).toBeVisible({ timeout: 15_000 });
        const stranded = await page.evaluate(() => {
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
        expect(stranded).toEqual([]);
    });
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

/**
 * The shell's deferred providers (AuthKit on load or idle within 5s, PostHog
 * within 8s) used to wrap the page, so mounting them swapped the element above
 * every page: the page went blank while their code loaded, then remounted,
 * closing open dialogs and resetting the role stack. They sit beside it now.
 */
for (const path of ["/jobs", "/about"]) {
    test(`${path} is never torn down and rebuilt after it loads`, { tag: ["@J-NAV-41"] }, async ({ page, diagnostics }) => {
        await returningVisitor(page);
        await page.addInitScript(() => {
            const w = window as unknown as { __mainRemovals: number };
            w.__mainRemovals = 0;
            new MutationObserver((records) => {
                for (const record of records)
                    for (const node of record.removedNodes) if (node instanceof HTMLElement && node.id === "main") w.__mainRemovals++;
            }).observe(document, { childList: true, subtree: true });
        });
        await page.goto(path);
        await expect(page.getByTestId("topbar-signin")).toBeVisible({ timeout: 15_000 });
        // Past both providers' idle deadlines, with time for their code to load.
        await page.waitForTimeout(10_000);
        expect(await page.evaluate(() => (window as unknown as { __mainRemovals: number }).__mainRemovals), "times the page was removed and rebuilt").toBe(0);
        await expect(page.locator("#main")).toBeVisible();
        expect(diagnostics.pageErrors).toEqual([]);
    });
}

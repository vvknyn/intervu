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

/** Opens `path` as a returning visitor once the board (and its toolbar) is up. */
async function openBoard(page: Page, path: string) {
    await returningVisitor(page);
    await page.goto(path);
    await expect(page.getByTestId("topbar-signin")).toBeVisible({ timeout: 15_000 });
    // The board mounts after hydration and can land after the header's
    // sign-in link; measuring before it did is how a stranded control on the
    // phone toolbar went unseen. The Filters button sits in the board's toolbar.
    await expect(page.locator('[data-testid="filters-toggle"], [data-testid="topbar-docked-filters-toggle"]').first()).toBeVisible({ timeout: 15_000 });
}

for (const path of ["/", "/jobs", "/jobs?q=engineer"]) {
    test(`no wrapping row on ${path} strands its last control on a line of its own`, { tag: ["@J-NAV-35"] }, async ({ page }) => {
        await openBoard(page, path);
        expect(await strandedControls(page)).toEqual([]);
    });
}

// The mobile project is 390 wide; the common narrower phones are 375 and 360,
// and 320 is the narrowest still in use.
for (const width of [375, 360, 320]) {
    for (const path of ["/jobs", "/jobs?q=engineer"]) {
        test(`on a ${width}px phone no wrapping row on ${path} strands its last control`, { tag: ["@J-NAV-41"] }, async ({ page }, testInfo) => {
            test.skip(testInfo.project.name !== "mobile", "a phone width");
            await page.setViewportSize({ width, height: 800 });
            await openBoard(page, path);
            await expect(page.getByTestId("filters-toggle")).toBeVisible();
            expect(await strandedControls(page)).toEqual([]);
            // The page itself never scrolls sideways: whatever is wider than the phone scrolls inside its own row.
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
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

/**
 * J-NAV-50: every visible heading is one of the four looks of the heading scale (docs/design-language.md §3):
 * page title 28px, section 20px, sub-heading 16px (all semibold), or the group label (12px semibold in the
 * secondary colour). 37 headings had drifted to 12px and 14px, in six looks of their own (2026-11-08). An sr-only h1 has no
 * look, and an accordion's h3 only wraps its trigger button, whose look is the row's.
 */
const HEADING_ROUTES = ["/connect", "/about", "/privacy", "/pricing", "/login", "/mock/company-page", "/mock/related-jobs?view=page"];

for (const path of HEADING_ROUTES) {
    test(`${path}: every visible heading is a page title, section, sub-heading or group label`, { tag: ["@J-NAV-50"] }, async ({ page }) => {
        await returningVisitor(page);
        await page.goto(path);
        await expect(page.locator("h1, h2, h3").first()).toBeAttached({ timeout: 15_000 });
        const offScale = await page.evaluate(() => {
            const probe = document.createElement("span");
            probe.className = "text-muted-foreground";
            document.body.append(probe);
            const secondary = getComputedStyle(probe).color;
            probe.remove();
            const looks = new Set(["28px/600", "20px/600", "16px/600"]);
            return [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")]
                .filter((h) => {
                    const r = h.getBoundingClientRect();
                    const cs = getComputedStyle(h);
                    return r.width > 1 && r.height > 1 && cs.visibility !== "hidden" && !h.closest("[aria-hidden=true]") && !h.querySelector("button");
                })
                .map((h) => {
                    const cs = getComputedStyle(h);
                    const look = `${cs.fontSize}/${cs.fontWeight}`;
                    const ok = looks.has(look) || (look === "12px/600" && cs.color === secondary);
                    return ok ? "" : `${h.tagName.toLowerCase()} ${look} ${cs.color === secondary ? "secondary" : cs.color} "${(h.textContent ?? "").trim().slice(0, 40)}"`;
                })
                .filter(Boolean);
        });
        expect(offScale).toEqual([]);
    });
}

/**
 * J-NAV-51: a text field looks the same on every page (docs/design-language.md §5): the sign-in form's fields
 * were a darker well (`bg-surface-2`) than the contact form's (`bg-card`). The header's search dock is its own
 * control and is left out.
 */
test("the sign-in and contact forms' text fields share one fill, the field's own", { tag: ["@J-NAV-51"] }, async ({ page }) => {
    await returningVisitor(page);
    const fills: Record<string, string[]> = {};
    for (const path of ["/login", "/contact"]) {
        await page.goto(path);
        await expect(page.locator("main input:not([type=hidden]), main textarea").first()).toBeVisible({ timeout: 15_000 });
        fills[path] = await page.evaluate(() =>
            [...document.querySelectorAll("input, textarea, select")]
                .filter((e) => {
                    const r = e.getBoundingClientRect();
                    const type = e.getAttribute("type") ?? "text";
                    // The contact form's spam trap sits off-screen under aria-hidden; it is not a field anyone sees.
                    return r.width > 1 && r.height > 1 && !e.closest("header, nav, [aria-hidden=true]") && !["hidden", "checkbox", "radio", "search", "file"].includes(type);
                })
                .map((e) => getComputedStyle(e).backgroundColor),
        );
        expect(fills[path].length, `${path} has text fields`).toBeGreaterThan(0);
    }
    const card = await page.evaluate(() => {
        const probe = document.createElement("div");
        probe.className = "bg-card";
        document.body.append(probe);
        const c = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return c;
    });
    expect([...new Set([...fills["/login"], ...fills["/contact"]])]).toEqual([card]);
});

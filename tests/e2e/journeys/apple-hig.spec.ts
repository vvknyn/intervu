import type { Page } from "@playwright/test";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { expect, test } from "./fixtures";

/**
 * Journeys for Apple's Human Interface Guidelines on a phone and in the list, one per class the 2026-11-02 audit
 * found (/mnt/project-files/apple-hig-audit/audit.md). Each measures the rendered page, not a class name, so a
 * control or bar added later is held to the same rule. See tests/journeys/CATALOG.md (J-HIG-01..10). Read-only:
 * search answers are replaced in the browser where a list is needed (no backend).
 */

const returningVisitor = (page: Page) =>
    page.addInitScript((key) => localStorage.setItem(key, "1"), ONBOARDING_COMPLETED_STORAGE_KEY);

/** Constructed postings (no real company). */
const posting = (n: number, title: string, company: string) => ({
    id: `66666666-0000-4000-8000-00000000000${n}`,
    title,
    company,
    company_domain: null,
    location: "Toronto, ON",
    work_type: "hybrid",
    employment_type: "full_time",
    experience_level: "mid",
    tags: [],
    apply_url: "https://example.com/apply",
    source: "journey",
    posted_at: new Date(Date.now() - 86_400_000).toISOString(),
    vacancy_status: "open",
    ghost_badge: "unscored",
});

async function listedRows(
    page: Page,
    hits = [posting(1, "Product Manager", "Maple Relay"), posting(2, "Product Owner", "Prairie Stack"), posting(3, "Platform Product Manager", "Birch Cloud")],
) {
    await returningVisitor(page);
    await page.route("**/api/jobs/search", (route) =>
        route.fulfill({ contentType: "application/json", body: JSON.stringify({ hits, total: hits.length, backend: "meilisearch", configured: true, searchId: "journey-hig" }) }),
    );
    await page.goto("/jobs?q=product%20manager");
    await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 45_000 });
}

/**
 * Every visible control's tap area, measured the way a finger meets it: from the control's centre outwards along
 * its row and its column, how far `elementFromPoint` still lands on the control (its invisible 44pt box counts; a
 * neighbour painted over it or a clipping parent does not). Links inside running text are reported apart.
 */
function tapAreas(page: Page) {
    return page.evaluate(async () => {
        document.documentElement.style.scrollBehavior = "auto";
        const selector = 'a[href], button, [role="button"], [role="tab"], [role="switch"], summary, label:has(input[type="checkbox"], input[type="radio"])';
        const out: { text: string; inText: boolean; w: number; h: number }[] = [];
        for (const el of [...document.querySelectorAll<HTMLElement>(selector)]) {
            if (el.closest("nextjs-portal, details:not([open]), [aria-hidden=true], [inert]")) continue;
            if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") continue;
            const cs = getComputedStyle(el);
            if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
            el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
            await new Promise((r) => requestAnimationFrame(() => r(null)));
            const rects = [...el.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
            if (!rects.length) continue;
            const r = rects.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
            if (r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight) continue; // a sideways scroller's off-screen item
            const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
            const on = (x: number, y: number) => {
                const hit = document.elementFromPoint(x, y);
                return !!hit && (hit === el || el.contains(hit));
            };
            if (!on(cx, cy)) continue; // covered at its centre (under a pinned bar): not reachable here, not measured
            const reach = (dx: number, dy: number) => {
                let d = 0;
                while (d < 30 && on(cx + dx * (d + 1), cy + dy * (d + 1))) d++;
                return d;
            };
            const w = reach(1, 0) + reach(-1, 0) + 1;
            const h = reach(0, 1) + reach(0, -1) + 1;
            const inText = cs.display === "inline" && !!el.closest("p, .prose, article li");
            const text = (el.innerText || el.getAttribute("aria-label") || el.getAttribute("title") || "").trim().slice(0, 40);
            out.push({ text, inText, w, h });
        }
        return out;
    });
}

for (const route of ["/jobs", "/pricing", "/login", "/about", "/connect", "/connect/help", "/resume"]) {
    test(`on a phone every control on ${route} is at least 44pt square to a finger, and a link in running text at least line tall`, { tag: ["@J-HIG-01"] }, async ({ page, diagnostics }, testInfo) => {
        test.skip(testInfo.project.name !== "mobile", "a phone width");
        if (route === "/jobs") {
            // /jobs with rows: on an empty list the check passed vacuously while every job title was 22pt tall to a
            // finger (its own line-clamp clipped its tap floor; release gate, 2026-11-05). One title short, one long
            // enough to clamp.
            await listedRows(page, [
                posting(1, "Clinical Research Assistant", "Maple Relay"),
                posting(2, "Senior Product Manager, Platform Payments and Billing Infrastructure", "Prairie Stack"),
                posting(3, "Telehealth Registered Nurse", "Birch Cloud"),
            ]);
        } else {
            await returningVisitor(page);
            await page.goto(route);
        }
        await page.waitForLoadState("load");
        // The dev server's own badge sits over the first tab; production has none.
        await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
        await page.waitForTimeout(1500);
        const areas = await tapAreas(page);
        expect(areas.length).toBeGreaterThan(3);
        if (route === "/jobs") {
            const titles = areas.filter((a) => /Clinical Research|Senior Product Manager|Telehealth/.test(a.text));
            expect(titles.length, `the list's job titles were measured: ${JSON.stringify(areas.map((a) => a.text))}`).toBeGreaterThanOrEqual(3);
        }
        // HIG Buttons / Accessibility: a 44x44pt hit region. A link inside running text cannot be 44pt without covering
        // the lines around it; it gets the floor where the lines leave room and at least the line it sits on.
        const small = areas.filter((a) => (a.inText ? a.h < 22 : a.w < 43 || a.h < 43));
        expect(small, `tap areas under the floor on ${route}: ${JSON.stringify(small)}`).toEqual([]);
        expect(diagnostics.pageErrors).toEqual([]);
    });
}

test("on a phone the tab bar's tabs are single words that never change, each named for VoiceOver", { tag: ["@J-HIG-08"] }, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "a phone width");
    await returningVisitor(page);
    await page.goto("/pricing");
    const tabs = page.getByTestId("mobile-tabbar").getByRole("link");
    await expect(tabs).toHaveCount(4, { timeout: 15_000 });
    // HIG Tab bars: "Use single words whenever possible". The résumé tab read "Add résumé" until a résumé existed.
    expect(await tabs.allInnerTexts()).toEqual(["Jobs", "Résumé", "Tracker", "Account"]);
    // The name is on the link itself, so the minimized dock's round button (label hidden) still has one (J-HIG-02).
    for (const name of ["Jobs", "Résumé", "Tracker", "Account"]) {
        await expect(page.getByTestId("mobile-tabbar").getByRole("link", { name, exact: true })).toHaveCount(1);
    }
});

test("on a phone a dialog is a floating sheet with a grabber that a swipe down closes", { tag: ["@J-HIG-03"] }, async ({ page, diagnostics }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "a phone width");
    await returningVisitor(page);
    await page.goto("/pricing");
    await page.getByTestId("topbar-signin").click();
    const dialog = page.locator('[data-slot="dialog-content"]');
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(400); // the slide-in
    const handle = dialog.locator("[data-sheet-handle]");
    await expect(handle).toBeVisible();
    // iOS 26 sheet: inset from the screen's sides and bottom, corners rounded.
    const geo = await dialog.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: innerWidth - r.right, bottom: innerHeight - r.bottom, radius: parseFloat(getComputedStyle(el).borderBottomLeftRadius) };
    });
    expect(geo.left).toBeGreaterThanOrEqual(6);
    expect(geo.right).toBeGreaterThanOrEqual(6);
    expect(geo.bottom).toBeGreaterThanOrEqual(6);
    expect(geo.radius).toBeGreaterThanOrEqual(24);
    // HIG Sheets: "Support swiping to dismiss a sheet". Drag the grabber down.
    const h = (await handle.boundingBox())!;
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2 + 6);
    await page.mouse.down();
    for (let dy = 10; dy <= 260; dy += 25) await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2 + 6 + dy);
    await page.mouse.up();
    await expect(dialog).toBeHidden({ timeout: 5_000 });
    expect(diagnostics.pageErrors).toEqual([]);
});

test("the page tells the phone it is dark, and Increase Contrast raises secondary text and hairlines", { tag: ["@J-HIG-04"] }, async ({ page }) => {
    await returningVisitor(page);
    await page.goto("/pricing");
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", /#0b0d12/i);
    await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute("content", /dark/);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("dark");
    const tokens = () =>
        page.evaluate(() => {
            const cs = getComputedStyle(document.documentElement);
            return { muted: cs.getPropertyValue("--muted-foreground").trim(), border: cs.getPropertyValue("--border").trim() };
        });
    const normal = await tokens();
    await page.emulateMedia({ contrast: "more" });
    const more = await tokens();
    const lum = (v: string) => v.split(/\s+/).map(Number).reduce((a, b) => a + b, 0);
    expect(lum(more.muted)).toBeGreaterThan(lum(normal.muted));
    expect(lum(more.border)).toBeGreaterThan(lum(normal.border));
});

test("on a touch screen a control revealed on hover shows at rest", { tag: ["@J-HIG-05"] }, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "a touch screen");
    await page.goto("/pricing");
    expect(await page.evaluate(() => matchMedia("(hover: none)").matches)).toBe(true);
    // The rule is generic, so it is pinned on a constructed control with the classes the story list's edit button uses.
    const opacity = await page.evaluate(() => {
        const host = document.createElement("div");
        host.className = "group";
        host.innerHTML = '<button class="opacity-0 group-hover:opacity-100">Edit</button><button class="opacity-0 group-hover/row:opacity-100">Delete</button>';
        document.body.append(host);
        const values = [...host.querySelectorAll("button")].map((b) => getComputedStyle(b).opacity);
        host.remove();
        return values;
    });
    expect(opacity).toEqual(["1", "1"]);
});

test("a phone on its side keeps the pinned chrome to a sliver: the top bar scrolls away and the tab bar is compact", { tag: ["@J-HIG-06"] }, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "a phone");
    await page.setViewportSize({ width: 844, height: 390 });
    await returningVisitor(page);
    await page.goto("/pricing");
    const bar = page.getByTestId("mobile-tabbar");
    await expect(bar).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => window.scrollTo(0, 400));
    await page.waitForTimeout(400);
    const chrome = await page.evaluate(() => {
        const covered = (el: Element | null) => {
            if (!el) return 0;
            const r = el.getBoundingClientRect();
            return Math.max(0, Math.min(innerHeight, r.bottom) - Math.max(0, r.top));
        };
        const tab = document.querySelector("[data-mobile-tabbar]")!.getBoundingClientRect();
        return { top: covered(document.querySelector('[data-testid="topbar"]')), tabH: tab.height, tabGap: innerHeight - tab.bottom, below: innerHeight - tab.top };
    });
    // HIG Layout: adapt to orientation. It took 124px of 390 here, 188px on a job page.
    expect(chrome.top).toBe(0);
    expect(chrome.tabH).toBeLessThanOrEqual(46);
    expect(chrome.tabGap).toBeLessThanOrEqual(12);
    expect(chrome.below / 390).toBeLessThanOrEqual(0.16);
});

test("on a phone a page one level into a section has a Back button to it, and a section's own page has none", { tag: ["@J-HIG-07"] }, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "a phone width");
    await returningVisitor(page);
    await page.goto("/connect/help");
    const back = page.getByTestId("topbar-back");
    await expect(back).toBeVisible({ timeout: 15_000 });
    await expect(back).toHaveAccessibleName("Back to Connect");
    const size = (await back.boundingBox())!;
    expect(Math.min(size.width, size.height)).toBeGreaterThanOrEqual(44);
    // Opened cold (a shared link) there is no app page behind it: Back goes to the section.
    await back.click();
    await expect(page).toHaveURL(/\/connect$/);
    await expect(page.getByTestId("topbar-back")).toHaveCount(0);
});

test("on a phone the navigation layer is Liquid Glass and the content layer is not", { tag: ["@J-HIG-09"] }, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "a phone width");
    await returningVisitor(page);
    await page.goto("/pricing");
    await expect(page.getByTestId("mobile-tabbar")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("topbar-signin")).toBeVisible({ timeout: 15_000 });
    const layers = await page.evaluate(() => {
        const header = document.querySelector('[data-testid="topbar"]')!;
        const signin = document.querySelector('[data-testid="topbar-signin"]')!.parentElement!;
        const glassy = [...document.querySelectorAll("body *")].filter((el) => {
            const bf = getComputedStyle(el).backdropFilter;
            return bf && bf !== "none";
        });
        return {
            // HIG Toolbars: no slab of its own, a scroll edge instead.
            headerImage: getComputedStyle(header).backgroundImage,
            headerColor: getComputedStyle(header).backgroundColor,
            groupBlur: getComputedStyle(signin).backdropFilter,
            // HIG Materials: "Don't use Liquid Glass in the content layer".
            contentGlass: glassy.filter((el) => !el.closest('header, nav, [data-dock-accessory], [role="dialog"], [data-radix-popper-content-wrapper]')).map((el) => el.tagName + "." + String(el.className).slice(0, 40)),
        };
    });
    expect(layers.headerImage).toContain("gradient");
    expect(layers.headerColor).toBe("rgba(0, 0, 0, 0)");
    expect(layers.groupBlur).toContain("blur");
    expect(layers.contentGlass).toEqual([]);
    // The overlay layer: the sign-in sheet is the thicker, text-holding glass.
    await page.getByTestId("topbar-signin").click();
    const dialog = page.locator('[data-slot="dialog-content"]');
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    const sheet = await dialog.evaluate((el) => ({ blur: getComputedStyle(el).backdropFilter, fill: getComputedStyle(el).backgroundColor }));
    expect(sheet.blur).toContain("blur");
    const alpha = Number(sheet.fill.match(/rgba?\([^)]*?,\s*([\d.]+)\)$/)?.[1] ?? 1);
    expect(alpha).toBeGreaterThanOrEqual(0.8);
    expect(alpha).toBeLessThanOrEqual(0.92);
});

test("a list row's selection is a rounded highlight inset from the list's edges, not a band across it", { tag: ["@J-HIG-10"] }, async ({ page, diagnostics }) => {
    await listedRows(page);
    const row = page.getByTestId("job-row").nth(1);
    await row.click();
    const selected = page.locator('[data-testid="job-row"][aria-current="true"]');
    await expect(selected).toHaveCount(1, { timeout: 20_000 });
    const geo = await selected.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const p = el.parentElement!.getBoundingClientRect();
        return { radius: parseFloat(getComputedStyle(el).borderTopLeftRadius), insetLeft: r.left - p.left, insetRight: p.right - r.right };
    });
    // HIG Lists and tables: selection feedback. Apple draws it as a rounded lens inside the list.
    expect(geo.radius).toBeGreaterThanOrEqual(8);
    expect(geo.insetLeft).toBeGreaterThanOrEqual(4);
    expect(geo.insetRight).toBeGreaterThanOrEqual(4);
    expect(diagnostics.pageErrors).toEqual([]);
});

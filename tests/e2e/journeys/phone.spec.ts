import type { Locator, Page } from "@playwright/test";
import { APPLY_BUTTON_LABEL } from "../../../src/components/jobs/job-detail-facts";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { expect, test } from "./fixtures";

/**
 * Journeys for the phone layout: the search box, the toolbar, the rows and
 * the bottom sheets, at the mobile project's 390 and at 320, the narrowest
 * phone still in use. See tests/journeys/CATALOG.md (J-MOB-01/02/17/22-27).
 * Read-only.
 */

const returningVisitor = (page: Page) =>
    page.addInitScript((key) => localStorage.setItem(key, "1"), ONBOARDING_COMPLETED_STORAGE_KEY);

/** How far the page scrolls sideways; 0 when everything fits the screen. */
const sidewaysScroll = (page: Page) =>
    page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const box = async (locator: Locator) => (await locator.boundingBox())!;

/** Waits for the first rows, if this server's search answers at all. */
const rowsIfAny = (page: Page) =>
    page.getByTestId("job-row").first().waitFor({ timeout: 20_000 }).then(
        () => true,
        () => false,
    );

/**
 * Every "·" in `roots` that starts a line: the text before it ends on an
 * earlier line, or there is none. Hidden text (the lg-only company button,
 * sr-only labels) doesn't count.
 */
const leadingDots = (roots: Locator) =>
    roots.evaluateAll((els) => {
        const out: string[] = [];
        for (const root of els) {
            const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            let prev: DOMRect | null = null;
            for (let n = walk.nextNode() as Text | null; n; n = walk.nextNode() as Text | null) {
                const text = n.textContent ?? "";
                if (!text.trim() || (n.parentElement?.getBoundingClientRect().width ?? 0) <= 1) continue;
                const lastRect = (from: number, to: number) => {
                    const r = document.createRange();
                    r.setStart(n!, from);
                    r.setEnd(n!, to);
                    const rects = [...r.getClientRects()].filter((b) => b.width > 0);
                    return rects[rects.length - 1] ?? null;
                };
                for (let i = text.indexOf("·"); i >= 0; i = text.indexOf("·", i + 1)) {
                    const dot = lastRect(i, i + 1);
                    if (!dot) continue;
                    const before = text.slice(0, i).trim() ? lastRect(0, i) : prev;
                    // Same line: the text before it is centred within half a dot's height of it.
                    if (!before || Math.abs((before.top + before.bottom) / 2 - (dot.top + dot.bottom) / 2) > dot.height / 2) {
                        out.push(`${(root.textContent ?? "").trim().slice(0, 60)} :: "${text.trim()}"`);
                    }
                }
                prev = lastRect(0, text.length) ?? prev;
            }
        }
        return out;
    });

for (const width of [390, 320]) {
    for (const path of ["/jobs", "/jobs?q=engineer"]) {
        test(`on a ${width}px phone Search spans the search box under its two fields and the toolbar shares its edges, with no second Search bar (${path})`, { tag: ["@J-MOB-17"] }, async ({ page, diagnostics }, testInfo) => {
            test.skip(testInfo.project.name !== "mobile", "a phone width");
            await page.setViewportSize({ width, height: 800 });
            await returningVisitor(page);
            await page.goto(path);
            const dock = page.getByTestId("jobs-search-dock");
            const submit = page.locator('[data-testid="search-submit"]:visible');
            await expect(dock).toBeVisible({ timeout: 15_000 });
            await expect(submit).toHaveCount(1);
            const [d, s] = [await box(dock), await box(submit)];
            // It sat level with the first field, leaving a hole beside the second (2026-10-02).
            expect(s.y).toBeGreaterThanOrEqual(d.y + d.height);
            expect(Math.abs(s.x - d.x)).toBeLessThanOrEqual(1);
            expect(Math.abs(s.width - d.width)).toBeLessThanOrEqual(1);
            // A filled copy of it was pinned above the tab bar too.
            await expect(page.getByTestId("mobile-search-cta")).toHaveCount(0);

            const toolbar = page.getByTestId("jobs-toolbar");
            await expect(toolbar).toBeVisible();
            const t = await box(toolbar);
            expect(Math.abs(t.x - d.x)).toBeLessThanOrEqual(1);
            expect(Math.abs(t.x + t.width - (d.x + d.width))).toBeLessThanOrEqual(1);
            if (path === "/jobs") {
                // At rest the toolbar has no fill, so its chips start on the box's edge, not 16px in.
                expect(Math.abs((await box(page.getByTestId("filters-toggle"))).x - d.x)).toBeLessThanOrEqual(1);
            }
            expect(diagnostics.pageErrors).toEqual([]);
        });
    }
}

for (const width of [390, 360, 320]) {
    test(`the /jobs landing does not scroll sideways at ${width}`, { tag: ["@J-MOB-01"] }, async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== "mobile", "a phone width");
        await page.setViewportSize({ width, height: 800 });
        await page.goto("/jobs");
        await expect(page.getByTestId("jobs-search-dock")).toBeVisible({ timeout: 15_000 });
        await expect(page.getByTestId("front-door-field-links")).toBeVisible();
        expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
    });

    test(`a search's results do not scroll sideways at ${width}`, { tag: ["@J-MOB-02"] }, async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== "mobile", "a phone width");
        await page.setViewportSize({ width, height: 800 });
        await returningVisitor(page);
        await page.goto("/jobs?q=product+designer");
        await expect(page.getByTestId("jobs-toolbar")).toBeVisible({ timeout: 15_000 });
        await rowsIfAny(page);
        expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
    });
}

test("on a 320px phone /connect and /trends fit the screen: the client tabs scroll inside their row and the trend bars keep their width", { tag: ["@J-MOB-22"] }, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "a phone width");
    await page.setViewportSize({ width: 320, height: 800 });

    await page.goto("/connect");
    const tabs = page.getByRole("tab");
    await expect(tabs.first()).toBeVisible({ timeout: 15_000 });
    // The client tabs ran 25px past the screen and dragged the page with them (2026-10-02).
    expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
    const last = tabs.last();
    await last.click();
    await expect(last).toHaveAttribute("aria-selected", "true");
    expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);

    await page.goto("/trends");
    const bars = page.getByTestId("trend-bar-track");
    const down = page.getByText("Market data isn't available right now.");
    await expect(bars.first().or(down)).toBeVisible({ timeout: 15_000 });
    expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
    if (await down.isVisible()) {
        test.info().annotations.push({ type: "skipped-part", description: "/trends has no market data on this server, so there are no bars to measure" });
        return;
    }
    // Four columns left the bar 0px wide on a 320px phone; it now has its own line.
    const widths = await bars.evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height > 0).map((e) => Math.round(e.getBoundingClientRect().width)));
    expect(widths.length).toBeGreaterThan(0);
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(120);
});

for (const width of [390, 320]) {
    test(`on a ${width}px phone the landing's "Browse by field" chips are toolbar chips and each one runs its search`, { tag: ["@J-MOB-23"] }, async ({ page, diagnostics }, testInfo) => {
        test.skip(testInfo.project.name !== "mobile", "a phone width");
        await page.setViewportSize({ width, height: 800 });
        await returningVisitor(page);
        await page.goto("/jobs");
        const chips = page.getByTestId("front-door-field-chip");
        await expect(chips.first()).toBeVisible({ timeout: 15_000 });
        expect(await chips.count()).toBeGreaterThanOrEqual(3);
        // They were dot-separated text links with 20px tap targets and a "·" hanging off each line.
        const filtersHeight = Math.round((await box(page.getByTestId("filters-toggle"))).height);
        const heights = await chips.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
        expect(new Set(heights)).toEqual(new Set([filtersHeight]));
        await chips.first().click();
        await expect(page).toHaveURL(/[?&]q=/, { timeout: 10_000 });
        expect(diagnostics.pageErrors).toEqual([]);
    });
}

test("on a 320px phone an opened job shows Apply and Save once each, in the bar under the sheet, and no line in it starts with a dot", { tag: ["@J-MOB-24"] }, async ({ page, diagnostics }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "a phone width");
    await page.setViewportSize({ width: 320, height: 800 });
    await returningVisitor(page);
    await page.goto("/jobs?q=engineer");
    test.skip(!(await rowsIfAny(page)), "this server lists no jobs (no search backend), so there is no job to open");
    await page.getByTestId("job-row").first().click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByTestId("mobile-detail-scroller")).toBeVisible({ timeout: 15_000 });
    const bar = sheet.getByTestId("job-detail-action-bar");
    await expect(bar).toBeVisible();
    // The pane above the bar had its own white Apply and outlined Save: two of each, in two styles (2026-10-02).
    const apply = sheet.getByRole("button", { name: APPLY_BUTTON_LABEL });
    if (await apply.count()) {
        await expect(apply).toHaveCount(1);
        await expect(bar.getByRole("button", { name: APPLY_BUTTON_LABEL })).toBeVisible();
    }
    const save = sheet.getByRole("button", { name: /^(Save this job|Saved)/ });
    await expect(save).toHaveCount(1);
    await expect(bar.getByRole("button", { name: /^(Save this job|Saved)/ })).toBeVisible();
    // "Part Time ·   Mid", and "· 1/2 favorable" wrapped under "Posting check".
    await expect.poll(() => leadingDots(sheet.getByTestId("mobile-detail-scroller")), { timeout: 10_000 }).toEqual([]);
    expect(diagnostics.pageErrors).toEqual([]);
});

/** The sheet's own bar: its title, then a Close above `content`; Close shuts it. */
async function expectSheetBar(page: Page, title: string | RegExp, content: Locator) {
    const sheet = page.getByRole("dialog", { name: title });
    await expect(sheet).toBeVisible({ timeout: 15_000 });
    const close = sheet.getByRole("button", { name: "Close", exact: true });
    await expect(close).toHaveCount(1);
    await expect(content).toBeVisible();
    // Filters had no title, and its × floated over the counts as they scrolled under it (2026-10-02).
    // Polled: the sheet slides up as it opens, so two reads mid-slide disagree.
    await expect
        .poll(async () => {
            const [c, body] = [await box(close), await box(content)];
            return c.y + c.height - body.y;
        })
        .toBeLessThanOrEqual(1);
    await close.click();
    await expect(sheet).toBeHidden();
}

test("on a phone every bottom sheet opens under the same bar: a title and a Close above its content (filters, location, tracker)", { tag: ["@J-MOB-25"] }, async ({ page, diagnostics }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "a phone width");
    await returningVisitor(page);
    const now = new Date().toISOString();
    await page.addInitScript(
        (seed) => localStorage.setItem("intervu.pursuits.guest", JSON.stringify([seed])),
        {
            id: "guest-journey-sheet",
            user_id: "guest",
            company_name: "Acme Corp",
            position: "Staff Engineer",
            status: "applied",
            job_id: "job-journey-sheet",
            job_snapshot: { title: "Staff Engineer", company: "Acme Corp", location: "Remote", description: "Build things.", apply_url: "https://example.com/jobs/1" },
            created_at: now,
            updated_at: now,
        },
    );

    await page.goto("/jobs?q=engineer");
    await page.getByTestId("filters-toggle").click();
    await expectSheetBar(page, "Filters", page.getByTestId("filters-panel"));

    await page.goto("/jobs");
    await page.getByTestId("location-picker-trigger").click();
    await expectSheetBar(page, "Where do you want to work?", page.getByRole("dialog").getByRole("checkbox").first());

    await page.goto("/yours");
    await page.getByTestId("tracker-track-role-cta").first().click();
    await expectSheetBar(page, "Track a role", page.getByRole("dialog").getByRole("textbox").first());

    await page.goto("/yours");
    await page.getByTestId("pursuit-row").first().click();
    await expectSheetBar(page, "Staff Engineer", page.getByRole("dialog").getByTestId("pursuit-status-picker"));
    expect(diagnostics.pageErrors).toEqual([]);
});

for (const width of [390, 320]) {
    test(`on a ${width}px phone no line of a result row starts with a dot`, { tag: ["@J-MOB-26"] }, async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== "mobile", "a phone width");
        await page.setViewportSize({ width, height: 800 });
        await returningVisitor(page);
        await page.goto("/jobs?q=engineer");
        test.skip(!(await rowsIfAny(page)), "this server lists no jobs (no search backend)");
        // A location too long for the company's line wrapped as "· Toronto, ON, Canada" (2026-10-02).
        expect(await leadingDots(page.getByTestId("job-row"))).toEqual([]);
    });
}

/**
 * A finger on the phone's screen: down at (x, y), `dy` px straight down in
 * eight moves, then up. CDP touches, not the mouse, so the browser's own touch
 * handling (panning, touch-action) runs as it does on a phone.
 */
async function fingerDrag(page: Page, x: number, y: number, dy: number) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (let i = 1; i <= 8; i++) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + (dy * i) / 8 }] });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
}

/**
 * Pulls the open sheet down by its bar: a short pull lets go and it settles
 * back, open; a long one closes it.
 */
async function expectSwipeCloses(sheet: Locator) {
    await expect(sheet).toBeVisible({ timeout: 15_000 });
    // Its top where it rests: done sliding up, and done growing as its content
    // loads (the job sheet opens short, then fills).
    await expect.poll(() => sheet.evaluate((el) => el.getAnimations().length), { timeout: 10_000 }).toBe(0);
    let lastY = NaN;
    await expect
        .poll(
            async () => {
                const y = Math.round((await box(sheet)).y);
                const still = y === lastY;
                lastY = y;
                return still;
            },
            { intervals: [300], timeout: 15_000 },
        )
        .toBe(true);
    const open = await box(sheet);
    // The handle's row, mid-width: clear of the Close at the bar's right end.
    const [x, y] = [open.x + open.width / 2, open.y + 10];

    await fingerDrag(sheet.page(), x, y, 40);
    await expect.poll(async () => Math.round((await box(sheet)).y - open.y)).toBe(0);
    await expect(sheet).toBeVisible();

    // Only a shared job link's sheet, open as the page loaded, closed this way;
    // every sheet opened later ignored the swipe in a production build (2026-10-03).
    await fingerDrag(sheet.page(), x, y, 240);
    await expect(sheet).toBeHidden();
}

test("on a phone a swipe down on a sheet's bar closes it, and a short pull lets it settle back open (filters, location, tracker, job)", { tag: ["@J-MOB-27"] }, async ({ page, diagnostics }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "a phone width");
    await returningVisitor(page);
    const now = new Date().toISOString();
    await page.addInitScript(
        (seed) => localStorage.setItem("intervu.pursuits.guest", JSON.stringify([seed])),
        {
            id: "guest-journey-swipe",
            user_id: "guest",
            company_name: "Acme Corp",
            position: "Staff Engineer",
            status: "applied",
            job_id: "job-journey-swipe",
            job_snapshot: { title: "Staff Engineer", company: "Acme Corp", location: "Remote", description: "Build things.", apply_url: "https://example.com/jobs/1" },
            created_at: now,
            updated_at: now,
        },
    );

    await page.goto("/jobs?q=engineer");
    await page.getByTestId("filters-toggle").click();
    await expectSwipeCloses(page.getByRole("dialog", { name: "Filters" }));

    await page.goto("/jobs");
    await page.getByTestId("location-picker-trigger").click();
    await expectSwipeCloses(page.getByRole("dialog", { name: "Where do you want to work?" }));

    await page.goto("/yours");
    await page.getByTestId("tracker-track-role-cta").first().click();
    await expectSwipeCloses(page.getByRole("dialog", { name: "Track a role" }));

    await page.goto("/yours");
    await page.getByTestId("pursuit-row").first().click();
    await expectSwipeCloses(page.getByRole("dialog", { name: "Staff Engineer" }));

    await page.goto("/jobs?q=engineer");
    if (await rowsIfAny(page)) {
        await page.getByTestId("job-row").first().click();
        await expect(page).toHaveURL(/[?&]job=/, { timeout: 15_000 });
        const sheet = page.getByRole("dialog");
        await expect(sheet.getByTestId("mobile-detail-scroller")).toBeVisible({ timeout: 15_000 });
        await expectSwipeCloses(sheet);
        await expect(page).not.toHaveURL(/[?&]job=/);
    } else {
        test.info().annotations.push({ type: "skipped-part", description: "this server lists no jobs (no search backend), so there is no job sheet to swipe" });
    }
    expect(diagnostics.pageErrors).toEqual([]);
});

/**
 * The phone's location sheet had eleven country rows and an "Other" row to
 * open before a city could be typed, so a nurse in Calgary picked Canada and
 * got Edmonton and Hamilton (focus group, 2026-10-12). The sheet now opens
 * with the desktop box's search at the top.
 */
test("on a phone the location sheet searches places: typing a city and tapping it filters the results to that city", { tag: ["@J-MOB-13"] }, async ({ page, diagnostics }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "the location sheet is the phone's control");
    await returningVisitor(page);
    await page.goto("/jobs?q=engineer");
    test.skip(!(await rowsIfAny(page)), "this server lists no jobs (no search backend)");

    await page.getByTestId("location-picker-trigger").click();
    const sheet = page.getByRole("dialog", { name: "Where do you want to work?" });
    const box = sheet.getByTestId("location-sheet-input");
    await expect(box).toBeVisible();
    // The search sits above the country rows, where a thumb reaches it first.
    expect((await box.boundingBox())!.y).toBeLessThan((await sheet.getByTestId("location-sheet-country-canada").boundingBox())!.y);

    await box.fill("Toront");
    const toronto = sheet.getByRole("option").filter({ hasText: /^Toronto/ }).first();
    await expect(toronto).toBeVisible({ timeout: 15_000 });
    await toronto.click();

    await expect(sheet).toBeHidden();
    await expect(page.getByTestId("location-picker-trigger")).toContainText("Toronto", { timeout: 15_000 });
    await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 20_000 });
    const places = await page.getByTestId("job-row").locator('[data-testid="job-location"]').allInnerTexts();
    expect(places.length).toBeGreaterThan(0);
    for (const place of places) expect(place).toMatch(/Toronto|Remote/i);
    expect(diagnostics.pageErrors).toEqual([]);
});

/**
 * The search box's suggestions opened over the location row stacked under
 * it, so on a phone the row could not be reached while they showed, and a
 * tap there picked a suggestion instead (focus group, 2026-10-12).
 */
test("on a phone the search suggestions leave the location row uncovered, and tapping it opens the location sheet", { tag: ["@J-MOB-28"] }, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "the rows stack only on a phone");
    await returningVisitor(page);
    await page.goto("/jobs");
    const input = page.getByPlaceholder("Job title, skill, or company");
    await input.click();
    await input.pressSequentially("nurs");
    const list = page.getByRole("listbox", { name: "Search suggestions" });
    await expect(list).toBeVisible({ timeout: 15_000 });

    const trigger = page.getByTestId("location-picker-trigger");
    const row = await box(trigger);
    const panel = await box(list);
    expect(panel.y, "the suggestions start below the location row").toBeGreaterThanOrEqual(row.y + row.height);

    await trigger.click();
    await expect(page.getByRole("dialog", { name: "Where do you want to work?" })).toBeVisible();
});

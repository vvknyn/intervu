import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { expect, test } from "./fixtures";

/**
 * J-JOBS-163. The /jobs page's own search line keeps its box, and the page around it is drawn, while the search
 * field's code arrives late. The field is a lazy chunk; without its own boundary (`loading`) a late chunk suspends
 * the page-wide one: nothing of the page is drawn until the chunk arrives, and then everything re-runs.
 *
 * The chunk is held 1.5 s so the early frames are real, and the page is reached by client navigation from /about
 * (a server-drawn page keeps its HTML while a chunk is late, so a fresh load never shows the hide). Asserted:
 *  - the page (its toolbar rows) is drawn while the chunk is still held;
 *  - every animation frame records the search line's box (x, y, width, height) and whether the toolbar rows show;
 *    once the toolbar has shown, both are present in every later frame and the line's box is one value.
 * Scoped to the in-page `[data-search-line]`, which /jobs has at 1440 and 390 (with a query the desktop page docks
 * the search into the header, outside the page). Width is included: the in-page line has no sibling that settles
 * on its own.
 */
const LINE = "[data-search-line]";
const TOOLBAR = '[data-testid="jobs-toolbar-rows"]';

test("the search line does not move or resize, and the page is not hidden, while the search field's code arrives", { tag: ["@J-JOBS-163"] }, async ({ page }) => {
    await page.addInitScript((key) => localStorage.setItem(key, "1"), ONBOARDING_COMPLETED_STORAGE_KEY);
    await page.addInitScript(
        ([line, toolbar]) => {
            const w = window as unknown as { __frames: { box: string | null; toolbar: "absent" | "hidden" | "shown" }[] };
            w.__frames = [];
            const tick = () => {
                const el = document.querySelector(line);
                const r = el?.getBoundingClientRect();
                const tb = document.querySelector(toolbar);
                const tr = tb?.getBoundingClientRect();
                w.__frames.push({
                    box: r ? [r.x, r.y, r.width, r.height].map(Math.round).join(",") : null,
                    toolbar: !tb ? "absent" : tr!.height > 0 && getComputedStyle(tb).display !== "none" ? "shown" : "hidden",
                });
                requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        },
        [LINE, TOOLBAR],
    );
    let held = 0;
    let released = 0;
    // Chunk file names are hashes, so the field's chunk is recognised by what it defines.
    await page.route(/\/_next\/static\/chunks\/.*\.js/, async (route) => {
        const response = await route.fetch();
        if ((await response.text()).includes("function SearchAutocomplete(")) {
            held++;
            await new Promise((r) => setTimeout(r, 1_500));
            await route.fulfill({ response });
            released++;
            return;
        }
        await route.fulfill({ response });
    });
    // Client navigation, not a fresh load: a server-drawn page keeps its HTML while a chunk is late, and only a page
    // the browser draws itself is hidden by the boundary above it.
    await page.goto("/about");
    await expect.poll(() => page.evaluate(() => !!(window as unknown as { next?: { router?: unknown } }).next?.router), { message: "the app router is up" }).toBe(true);
    await page.evaluate(() => (window as unknown as { next: { router: { push(href: string): void } } }).next.router.push("/jobs"));
    // Before the boundary: with none of its own, the page is not drawn at all until the chunk arrives.
    await expect.poll(async () => (await page.locator(TOOLBAR).count()) > 0 || released > 0, { message: "the page was drawn", timeout: 30_000 }).toBe(true);
    expect(released, "the page was drawn while the search field's chunk was still held").toBe(0);
    await expect.poll(() => released, { message: "the held chunk was let through", timeout: 30_000 }).toBeGreaterThan(0);
    await expect(page.locator(`${LINE} input`).first()).toBeVisible();
    await page.waitForTimeout(500);
    expect(held, "the field's chunk was requested and held, so the early frames are pre-chunk").toBeGreaterThan(0);
    const frames = await page.evaluate(() => (window as unknown as { __frames: { box: string | null; toolbar: string }[] }).__frames);
    expect(frames.length).toBeGreaterThan(20);
    const firstShown = frames.findIndex((f) => f.toolbar === "shown");
    expect(firstShown, "the toolbar rows were on screen in some frame").toBeGreaterThanOrEqual(0);
    const after = frames.slice(firstShown);
    expect(after.filter((f) => f.toolbar !== "shown"), "frames after the toolbar first showed in which it was gone or hidden").toEqual([]);
    expect(after.filter((f) => f.box === null), "frames after the toolbar first showed in which the search line was gone").toEqual([]);
    expect([...new Set(after.map((f) => f.box))], "distinct boxes the search line took, once the page showed").toHaveLength(1);
});

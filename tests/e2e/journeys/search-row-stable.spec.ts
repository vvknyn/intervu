import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { expect, test } from "./fixtures";

/**
 * J-JOBS-163. The search row keeps its box while the search field's code arrives late: the field is a lazy
 * chunk with its own boundary (`loading`), and a placeholder that is smaller than the field would shift
 * everything below it. The chunk is held 1.5 s so the pre-chunk frames are real, then every frame's box
 * is compared with the settled one. Width is left out: the docked slot is flex-1 beside nav
 * items that settle on their own, with or without the chunk delay.
 */
// The in-page row at phone width; the docked header's search slot where the page docks it.
const SEARCH_ROW = '[data-search-line], [data-testid="topbar-docked-search"]';

test("the search row does not move or resize when the search field's code arrives", { tag: ["@J-JOBS-163"] }, async ({ page }) => {
    await page.addInitScript((key) => localStorage.setItem(key, "1"), ONBOARDING_COMPLETED_STORAGE_KEY);
    await page.addInitScript((sel) => {
        const w = window as unknown as { __boxes: string[] };
        w.__boxes = [];
        const tick = () => {
            const el = document.querySelector(sel);
            if (el) {
                const r = el.getBoundingClientRect();
                w.__boxes.push([r.x, r.y, r.height].map(Math.round).join(","));
            }
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }, SEARCH_ROW);
    let held = 0;
    // Chunk file names are hashes, so the field's chunk is recognised by what it defines.
    await page.route(/\/_next\/static\/chunks\/.*\.js/, async (route) => {
        const response = await route.fetch();
        if ((await response.text()).includes("function SearchAutocomplete(")) {
            held++;
            await new Promise((r) => setTimeout(r, 1_500));
        }
        await route.fulfill({ response });
    });
    await page.goto("/jobs?q=engineer");
    await expect(page.locator(`${SEARCH_ROW} input`).first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(500);
    expect(held, "the field's chunk was requested and held, so the early frames are pre-chunk").toBeGreaterThan(0);
    const boxes = await page.evaluate(() => (window as unknown as { __boxes: string[] }).__boxes);
    expect(boxes.length).toBeGreaterThan(20);
    expect([...new Set(boxes)], "distinct boxes the search row took, first paint to settled").toHaveLength(1);
});

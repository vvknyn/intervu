import type { Locator } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * Journey for a notice's dismiss × — see tests/journeys/CATALOG.md (J-NAV-45). Read-only.
 * The × sits in the notice's top-right corner, level with the first line of text, and never
 * joins the content's wrap (it used to drop to a line of its own under the icon when the card
 * was narrow). Every dismissible notice on /mock/dismiss is checked at each column width a
 * notice meets: a 320 and a 390 phone, and the /jobs list column. A local dev server only
 * (/mock fixtures are not served by a production build).
 */

const COLUMN_WIDTHS = [288, 358, 400, 470, 736];

/** Pixel positions of one notice's × against the notice box and its first line of text. */
const positions = (frame: Locator) =>
    frame.evaluate((el) => {
        const root = el.firstElementChild as HTMLElement;
        const button = root.querySelector<HTMLElement>('[aria-label^="Dismiss"]')!;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let lineTop = NaN;
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            if (!n.textContent?.trim() || button.contains(n)) continue;
            const range = document.createRange();
            range.selectNodeContents(n);
            lineTop = range.getClientRects()[0].top;
            break;
        }
        const b = button.getBoundingClientRect();
        const r = root.getBoundingClientRect();
        return { buttonTop: b.top, lineTop, buttonRightGap: r.right - b.right, height: r.height };
    });

test.beforeEach(({ baseURL }) => {
    const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseURL ?? "http://localhost:3000");
    test.skip(!local, "/mock fixtures are not served by a production build");
});

for (const width of COLUMN_WIDTHS) {
    test(`every dismissible notice keeps its × in the top-right corner at a ${width}px column`, { tag: ["@J-NAV-45"] }, async ({ page }) => {
        test.skip(width > (page.viewportSize()?.width ?? 0) - 32, "the column would not fit the viewport");
        await page.goto(`/mock/dismiss?w=${width}`);
        const frames = page.getByTestId("notice-frame");
        await expect(frames.locator('[aria-label^="Dismiss"]')).toHaveCount(4, { timeout: 30_000 });
        await page.waitForTimeout(500);
        for (let i = 0; i < 4; i++) {
            const p = await positions(frames.nth(i));
            expect(Math.abs(p.buttonTop - p.lineTop), `notice ${i}: × top vs first line top`).toBeLessThanOrEqual(4);
            expect(p.buttonRightGap, `notice ${i}: × right inset`).toBeLessThanOrEqual(17.5);
        }
    });
}

test("dismissing a notice hides it, and the others stay", { tag: ["@J-NAV-45"] }, async ({ page }) => {
    await page.goto("/mock/dismiss?w=358");
    const frames = page.getByTestId("notice-frame");
    const buttons = frames.locator('[aria-label^="Dismiss"]');
    await expect(buttons).toHaveCount(4, { timeout: 30_000 });
    await page.getByTestId("extension-tile").getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByTestId("extension-tile")).toHaveCount(0);
    await expect(buttons).toHaveCount(3);
});

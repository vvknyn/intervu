import { expect, test } from "./fixtures";

/**
 * Journey for the header logo — see tests/journeys/CATALOG.md (J-NAV-42).
 * Read-only.
 *
 * The header shows the paper tile the Chrome extension and the favicon show
 * (it used to show the navy brackets alone, which all but vanished on the
 * charcoal bar). The tile's corners must be transparent: the source icons
 * carry a white canvas, which would show as a white square on the header.
 */

for (const path of ["/jobs", "/about"]) {
    test(`${path}: the header logo is the paper tile, with no white square around it`, { tag: ["@J-NAV-42"] }, async ({ page }) => {
        await page.goto(path);
        const mark = page.getByTestId("topbar-logo").locator("img");
        await expect(mark).toBeVisible({ timeout: 15_000 });
        await expect.poll(() => mark.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);

        const shown = await mark.evaluate((img: HTMLImageElement) => {
            const canvas = document.createElement("canvas");
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext("2d")!;
            ctx.drawImage(img, 0, 0);
            const alpha = (x: number, y: number) => ctx.getImageData(x, y, 1, 1).data[3];
            const [r, g, b] = ctx.getImageData(Math.round(img.naturalWidth * 0.08), Math.round(img.naturalHeight / 2), 1, 1).data;
            const box = img.getBoundingClientRect();
            return {
                src: new URL(img.currentSrc).pathname,
                width: Math.round(box.width),
                height: Math.round(box.height),
                cornerAlpha: alpha(0, 0),
                centreAlpha: alpha(img.naturalWidth >> 1, img.naturalHeight >> 1),
                // The tile's left margin, between its edge and the left bracket: warm paper.
                paper: r > 230 && g > 225 && b > 215,
            };
        });

        expect(shown.src).toMatch(/^\/velai-tile(-96)?\.png$/);
        expect(shown.width).toBe(32);
        expect(shown.height).toBe(32);
        expect(shown.cornerAlpha).toBe(0);
        expect(shown.centreAlpha).toBe(255);
        expect(shown.paper).toBe(true);
    });
}

import { test, expect, type Page } from "@playwright/test";
import { deflateSync } from "node:zlib";

/** Solid-colour square PNG of the given edge, so the spec controls the source's natural size. */
function squarePng(edge: number): Buffer {
    const crc = (buf: Buffer) => {
        let c = ~0;
        for (const b of buf) {
            c ^= b;
            for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
        }
        return ~c >>> 0;
    };
    const chunk = (type: string, data: Buffer) => {
        const body = Buffer.concat([Buffer.from(type), data]);
        const out = Buffer.alloc(12 + data.length);
        out.writeUInt32BE(data.length, 0);
        body.copy(out, 4);
        out.writeUInt32BE(crc(body), 8 + data.length);
        return out;
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(edge, 0);
    ihdr.writeUInt32BE(edge, 4);
    ihdr.set([8, 6, 0, 0, 0], 8);
    const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(edge * 4, 0x80)]);
    const raw = Buffer.concat(Array.from({ length: edge }, () => row));
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk("IHDR", ihdr),
        chunk("IDAT", deflateSync(raw)),
        chunk("IEND", Buffer.alloc(0)),
    ]);
}

const SMALL = 16; // a favicon-class source (onlinejobs.ph, cisco.com ...)
const LARGE = 128; // what the proxy asks upstream for (sz=128)

async function stubLogos(page: Page, edgeFor: (domain: string) => number) {
    await page.route("**/logos/*.png", (route) => {
        const domain = decodeURIComponent(new URL(route.request().url()).pathname.slice("/logos/".length, -".png".length));
        return route.fulfill({ status: 200, contentType: "image/png", body: squarePng(edgeFor(domain)) });
    });
}

async function renderedBox(page: Page, alt: string) {
    const img = page.getByAltText(alt);
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(0);
    return img.evaluate((el: HTMLImageElement) => {
        const r = el.getBoundingClientRect();
        const tile = el.parentElement!.getBoundingClientRect();
        const pad = parseFloat(getComputedStyle(el).paddingLeft);
        return { natural: el.naturalWidth, drawn: r.width - 2 * pad, tile: tile.width };
    });
}

test.describe("company logo is never upscaled past its natural size", () => {
    test("a small source stays at natural size, centred in the tile", async ({ page }) => {
        await stubLogos(page, () => SMALL);
        await page.goto("/mock/completeness");
        const box = await renderedBox(page, "Adobe logo");
        expect(box.natural).toBe(SMALL);
        expect(box.drawn).toBeLessThanOrEqual(SMALL + 0.5);
        expect(box.tile).toBeGreaterThan(SMALL * 2);
    });

    test("a large source still fills the tile", async ({ page }) => {
        await stubLogos(page, () => LARGE);
        await page.goto("/mock/completeness");
        const box = await renderedBox(page, "Figma logo");
        expect(box.natural).toBe(LARGE);
        // tile minus 1px border each side and the p-1 (4px) padding each side
        expect(box.drawn).toBeGreaterThanOrEqual(box.tile - 2 - 8 - 1);
        expect(box.drawn).toBeLessThanOrEqual(box.tile);
    });
});

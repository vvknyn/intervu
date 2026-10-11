#!/usr/bin/env node
/**
 * Cuts the locked product mark's paper tile out of its white canvas so the
 * header can show the same tile the Chrome extension shows, on the charcoal
 * bar, without a white square or drop shadow around it.
 *
 * Source: public/icons/velai-icon-1024.png (the locked soft-card bigger-dot,
 * pixel-identical to extension/icons/*). The tile's four edges are the first
 * run of non-neutral pixels (warm paper or its rim, not the white canvas or grey
 * shadow) met walking in from each side along the centre row and column.
 * Its corners are rounded at 22% of its width, measured off the master's
 * corner arcs. Everything outside that rounded rectangle becomes transparent;
 * the tile is centred on a transparent square and resized.
 *
 * Writes:
 *   public/velai-tile.png     (512x512)
 *   public/velai-tile-96.png  (96x96, 3x the 32px TopBar tile)
 *
 * Re-run after any change to the locked master:
 *   node scripts/generate-header-tile.mjs
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const master = join(root, "public/icons/velai-icon-1024.png");

const { data, info } = await sharp(master).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: w, height: h } = info;

const neutralAt = (x, y) => {
  const i = (y * w + x) * 3;
  const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
  return Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b)) <= 3;
};
// The first of 6 non-neutral pixels in a row, so stray warm specks in the
// shadow don't count as the tile's edge.
const firstTile = (from, step, at) => {
  for (let p = from, run = 0; p >= 0 && p < Math.max(w, h); p += step) {
    run = neutralAt(...at(p)) ? 0 : run + 1;
    if (run === 6) return p - 5 * step;
  }
  throw new Error("no tile found in the master");
};

const midX = w >> 1;
const midY = h >> 1;
const left = firstTile(0, 1, (x) => [x, midY]);
const right = firstTile(w - 1, -1, (x) => [x, midY]);
const top = firstTile(0, 1, (y) => [midX, y]);
const bottom = firstTile(h - 1, -1, (y) => [midX, y]);
const tileW = right - left + 1;
const tileH = bottom - top + 1;
const radius = Math.round(tileW * 0.22);

const mask = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${tileW}" height="${tileH}">` +
    `<rect width="${tileW}" height="${tileH}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`,
);
const side = Math.max(tileW, tileH);
const tile = await sharp(master)
  .ensureAlpha()
  .extract({ left, top, width: tileW, height: tileH })
  .composite([{ input: mask, blend: "dest-in" }])
  .extend({
    top: Math.floor((side - tileH) / 2),
    bottom: Math.ceil((side - tileH) / 2),
    left: Math.floor((side - tileW) / 2),
    right: Math.ceil((side - tileW) / 2),
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .png()
  .toBuffer();

for (const [file, size] of [["public/velai-tile.png", 512], ["public/velai-tile-96.png", 96]]) {
  await sharp(tile).resize(size, size).png({ compressionLevel: 9 }).toFile(join(root, file));
  console.log(`${file} ${size}x${size} (tile ${tileW}x${tileH} at x=${left} y=${top}, radius ${radius})`);
}

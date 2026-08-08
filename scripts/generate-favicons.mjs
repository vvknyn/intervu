#!/usr/bin/env node
/**
 * Regenerates the entire favicon/icon set from one source asset:
 * src/app/icon.svg (the brand mark, self-contained with its dark background
 * baked in — safe to rasterize directly for apple-touch-icon, which doesn't
 * get transparency niceties).
 *
 * Before this script, `src/app/icon.png` and `public/intervu-logo.png` were
 * both a hand-exported 388x388 PNG (an odd size with no purpose-built
 * variants for the favicon.ico / apple-touch-icon / manifest icon slots).
 * This is the one place that derives every raster variant from the vector
 * source, so a future brand-mark change is one re-run, not a repeat
 * hand-export-and-resize.
 *
 * Re-run after any change to src/app/icon.svg:
 *   node scripts/generate-favicons.mjs
 *
 * Writes:
 *   src/app/favicon.ico       (16/32/48 multi-image ICO, PNG-embedded)
 *   src/app/icon.png          (32x32 — Next's `icon` file-convention tag)
 *   public/apple-touch-icon.png (180x180 — iOS home-screen/bookmark fallback)
 *   public/icon-192.png       (manifest)
 *   public/icon-512.png       (manifest + Organization JSON-LD logo)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const svgBuffer = readFileSync(join(root, "src/app/icon.svg"));

async function renderPng(size) {
  return sharp(svgBuffer).resize(size, size).png().toBuffer();
}

/** Assembles a valid ICO container (PNG-embedded images — supported by
 *  every modern browser and Windows Vista+) from same-index PNG buffers and
 *  their pixel sizes. ICO format: 6-byte ICONDIR header, then one 16-byte
 *  ICONDIRENTRY per image, then the raw image bytes back to back. */
function buildIco(pngBuffers, sizes) {
  const count = pngBuffers.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: 1 = icon
  header.writeUInt16LE(count, 4);

  let offset = 6 + 16 * count;
  const entries = [];
  for (let i = 0; i < count; i++) {
    const buf = pngBuffers[i];
    const size = sizes[i];
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 = 256px)
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // color count (0 = no palette)
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(buf.length, 8); // image data size
    entry.writeUInt32LE(offset, 12); // offset from file start
    offset += buf.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...pngBuffers]);
}

async function main() {
  const icoSizes = [16, 32, 48];
  const icoBuffers = await Promise.all(icoSizes.map(renderPng));
  writeFileSync(join(root, "src/app/favicon.ico"), buildIco(icoBuffers, icoSizes));

  // Reuse the 32px render already made for the ICO — the app/icon.png tag.
  writeFileSync(join(root, "src/app/icon.png"), icoBuffers[icoSizes.indexOf(32)]);

  const [apple, icon192, icon512] = await Promise.all([
    renderPng(180),
    renderPng(192),
    renderPng(512),
  ]);
  writeFileSync(join(root, "public/apple-touch-icon.png"), apple);
  writeFileSync(join(root, "public/icon-192.png"), icon192);
  writeFileSync(join(root, "public/icon-512.png"), icon512);

  console.log("Wrote favicon.ico, icon.png, apple-touch-icon.png, icon-192.png, icon-512.png");
}

main();

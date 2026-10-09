#!/usr/bin/env node
/**
 * Copies on-device OCR's worker, engine and English model out of
 * node_modules into public/ocr/, so a scanned PDF is read with files from
 * our own origin (src/lib/local-ai/ocr-pdf.ts), never a CDN. Runs as part
 * of npm's "prebuild" and "predev" hooks; pure local file ops, no network.
 * public/ocr is derived output (gitignored), regenerated every build.
 *
 * Only the LSTM engines are copied: ocr-pdf.ts asks for OEM.LSTM_ONLY, and
 * tesseract.js then loads exactly one of these three, by what the browser's
 * WebAssembly supports.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));
const out = join(root, "public", "ocr");
mkdirSync(out, { recursive: true });

const tesseractDir = dirname(require.resolve("tesseract.js/package.json"));
const coreDir = dirname(require.resolve("tesseract.js-core/package.json"));
const engDir = dirname(require.resolve("@tesseract.js-data/eng/package.json"));

const files = [
    [join(tesseractDir, "dist", "worker.min.js"), "worker.min.js"],
    [join(coreDir, "tesseract-core-lstm.wasm.js"), "tesseract-core-lstm.wasm.js"],
    [join(coreDir, "tesseract-core-simd-lstm.wasm.js"), "tesseract-core-simd-lstm.wasm.js"],
    [join(coreDir, "tesseract-core-relaxedsimd-lstm.wasm.js"), "tesseract-core-relaxedsimd-lstm.wasm.js"],
    // The integer "best" model: near-best accuracy at a quarter of the size.
    [join(engDir, "4.0.0_best_int", "eng.traineddata.gz"), "eng.traineddata.gz"],
];
for (const [from, name] of files) copyFileSync(from, join(out, name));
console.log(`copy-ocr-assets: ${files.length} files -> public/ocr`);

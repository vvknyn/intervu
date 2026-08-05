#!/usr/bin/env node
// Renders a film page to a numbered PNG sequence, one file per frame.
//
// The pages animate on one global clock. Rather than screen-record them — which
// gives you a variable frame rate and dropped frames — this pauses every
// animation on the page and sets `currentTime` by hand, frame by frame. Each
// frame is therefore exact, and two runs of the same commit produce the same
// pixels.
//
// Usage: node studio/render.mjs a-mcp
//        node studio/render.mjs b-openclaw

import { createServer } from "node:http";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));

const FILM = process.argv[2];
if (!FILM) {
  console.error("usage: node studio/render.mjs <a-mcp|b-openclaw>");
  process.exit(1);
}

const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;
const DURATION_MS = 21300;
const FRAMES = Math.round((DURATION_MS / 1000) * FPS);

const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};

// Chromium refuses cross-origin @font-face and @import over file://, so the
// studio directory is served instead. Nothing here reaches outside `here`.
const server = createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "");
  const path = resolve(here, rel);
  if (!path.startsWith(here)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = readFileSync(path);
    res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;

const outDir = join(here, ".frames", FILM);
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 1,
});

await page.goto(`${origin}/${FILM}.html`, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);

// Pausing up front means nothing advances on its own between screenshots; the
// only thing that moves the film is the currentTime we set below.
const tracked = await page.evaluate(() => {
  const animations = document.getAnimations();
  animations.forEach((a) => a.pause());
  return animations.length;
});
if (tracked === 0) throw new Error("no animations found — the page did not compose");
console.log(`${FILM}: ${tracked} animations, ${FRAMES} frames`);

const pad = (n) => String(n).padStart(4, "0");
const started = Date.now();

const pose = (ms) =>
  page.evaluate((at) => {
    document.getAnimations().forEach((a) => {
      a.pause();
      a.currentTime = at;
    });
    // One frame of grace so the compositor applies the poses we just set.
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, ms);

// --probe=1500,5500,... renders only those moments, named by timestamp, for
// eyeballing a change without paying for the whole sequence.
const probe = process.argv.find((a) => a.startsWith("--probe="));

if (probe) {
  const dir = join(here, ".frames", `${FILM}-probe`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const ms of probe.slice(8).split(",").map(Number)) {
    await pose(ms);
    await page.screenshot({ path: join(dir, `t-${pad(ms)}.png`), type: "png" });
  }
  console.log(`  probes → ${dir}`);
} else {
  for (let i = 0; i < FRAMES; i++) {
    await pose((i * 1000) / FPS);
    await page.screenshot({ path: join(outDir, `f-${pad(i)}.png`), type: "png" });
    if (i % 60 === 0 || i === FRAMES - 1) {
      process.stdout.write(`\r  frame ${i + 1}/${FRAMES}`);
    }
  }
  console.log(`\n  done in ${((Date.now() - started) / 1000).toFixed(1)}s → ${outDir}`);
}

await browser.close();
server.close();

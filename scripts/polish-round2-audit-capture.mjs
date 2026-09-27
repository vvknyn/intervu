#!/usr/bin/env node
/**
 * Round 2 polish audit captures — live velai.app + optional local base.
 * Usage:
 *   node scripts/polish-round2-audit-capture.mjs --out /path/to/media/polish/round2/audit-live
 *   node scripts/polish-round2-audit-capture.mjs --base http://localhost:3000 --out ... --mock
 */
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { linuxChromiumVisualQaLaunchOptions } from "./design/linux-chromium-visual-qa.cjs";

const LIVE_BASE = "https://velai.app";

const LIVE_ROUTES = [
  { name: "landing-jobs", path: "/jobs" },
  { name: "privacy", path: "/privacy" },
  { name: "resume-signed-out", path: "/resume" },
  { name: "about", path: "/about" },
  { name: "connect", path: "/connect" },
  { name: "terms", path: "/terms" },
];

const MOCK_ROUTES = [
  { name: "settings", path: "/mock/settings" },
  { name: "resume-states", path: "/mock/resume" },
  { name: "tracker-empty", path: "/mock/empty-states?surface=tracker" },
  { name: "email-nudge", path: "/mock/email-nudge" },
  { name: "for-you-deck", path: "/mock/for-you-deck" },
  { name: "search-dock", path: "/mock/search-dock" },
  { name: "company-cards", path: "/mock/company-cards" },
  { name: "completeness-tracker", path: "/mock/completeness" },
  { name: "settings-account", path: "/mock/settings?tab=account" },
];

const VIEWPORTS = [
  { tag: "desktop", width: 1440, height: 900 },
  { tag: "mobile", width: 390, height: 844 },
];

function parseArgs() {
  const args = process.argv.slice(2);
  let out = join(process.cwd(), "media/polish/round2/audit-live");
  let base = LIVE_BASE;
  let mock = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out" && args[i + 1]) out = args[++i];
    else if (args[i] === "--base" && args[i + 1]) base = args[++i];
    else if (args[i] === "--mock") mock = true;
  }
  return { out, base, mock };
}

async function captureRoute(page, url, filePath) {
  await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: filePath, fullPage: true });
}

async function main() {
  const { out, base, mock } = parseArgs();
  await mkdir(out, { recursive: true });
  const routes = mock ? MOCK_ROUTES : LIVE_ROUTES;
  const manifest = [];

  const browser = await chromium.launch(linuxChromiumVisualQaLaunchOptions());
  const context = await browser.newContext({ ignoreHTTPSErrors: true });

  for (const vp of VIEWPORTS) {
    const page = await context.newPage();
    await page.setViewportSize({ width: vp.width, height: vp.height });
    for (const route of routes) {
      const url = `${base.replace(/\/$/, "")}${route.path}`;
      const file = `${route.name}-${vp.tag}.png`;
      const filePath = join(out, file);
      try {
        await captureRoute(page, url, filePath);
        manifest.push({ route: route.name, viewport: vp.tag, url, file, ok: true });
        console.log("ok", file);
      } catch (e) {
        manifest.push({
          route: route.name,
          viewport: vp.tag,
          url,
          file,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
        console.error("fail", file, e);
      }
    }
    await page.close();
  }

  await browser.close();
  await writeFile(join(out, "manifest.json"), JSON.stringify({ base, mock, capturedAt: new Date().toISOString(), manifest }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

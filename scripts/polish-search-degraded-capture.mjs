#!/usr/bin/env node
import { chromium } from "@playwright/test";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { linuxChromiumVisualQaLaunchOptions } from "./design/linux-chromium-visual-qa.cjs";
const require = createRequire(import.meta.url);
const AXE = require.resolve("axe-core/axe.min.js");
const argv = process.argv.slice(2).filter((a) => a !== "--before");
const OUT = argv[0] || "/cursor/stores/bc-c68fc246-2df9-5e47-93dd-53b44f76f96f/media/polish/round2/batch-search-degraded";
const BASE = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
const MODE = process.argv.includes("--before") ? "before" : "after";
const REBASELINE_BEFORE = {
  desktop: "/cursor/stores/bc-c68fc246-2df9-5e47-93dd-53b44f76f96f/media/polish/rebaseline/staging-jobs-search-degraded-desktop.png",
  mobile: "/cursor/stores/bc-c68fc246-2df9-5e47-93dd-53b44f76f96f/media/polish/rebaseline/staging-jobs-search-degraded-mobile.png",
};
const VIEWPORTS = [{ tag: "desktop", width: 1440, height: 900 }, { tag: "mobile", width: 390, height: 844 }];
const SEARCH_URL = `${BASE}/jobs?q=software%20engineer&posted=any`;
async function runAxe(page) {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async () => {
    const root = document.querySelector("main") || document.body;
    const result = await globalThis.axe.run(root, { runOnly: { type: "rule", values: ["color-contrast"] } });
    const violationCount = (result.violations || []).reduce((n, v) => n + (v.nodes?.length || 0), 0);
    const incompleteCount = (result.incomplete || []).reduce((n, v) => n + (v.nodes?.length || 0), 0);
    return { violationCount, incompleteCount, pass: violationCount === 0 && incompleteCount === 0 };
  });
}
async function preparePage(page) {
  await page.addInitScript(() => {
    try { localStorage.setItem("velai.onboarding.completed", "1"); } catch {}
  });
  await page.route("**/*", async (route) => {
    const req = route.request();
    if (req.method() === "POST" && req.headers()["next-action"]) {
      await route.fulfill({ status: 500, contentType: "text/plain", body: "simulated failure" });
      return;
    }
    await route.continue();
  });
  await page.goto(SEARCH_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByTestId("jobs-rank-by-fit").or(page.getByText(/Search is temporarily unavailable/i)).first().waitFor({ timeout: 45000 });
  await page.waitForTimeout(600);
}
async function main() {
  await mkdir(OUT, { recursive: true });
  if (MODE === "before") {
    for (const vp of VIEWPORTS) await copyFile(REBASELINE_BEFORE[vp.tag], join(OUT, `before-jobs-search-degraded-${vp.tag}.png`));
    return;
  }
  const browser = await chromium.launch(linuxChromiumVisualQaLaunchOptions());
  const axeResults = {};
  for (const vp of VIEWPORTS) {
    const page = await browser.newPage();
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await preparePage(page);
    await page.screenshot({ path: join(OUT, `after-jobs-search-degraded-${vp.tag}.png`), fullPage: true });
    axeResults[vp.tag] = await runAxe(page);
    await page.close();
  }
  await browser.close();
  await writeFile(join(OUT, "axe-color-contrast.json"), JSON.stringify(axeResults, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });

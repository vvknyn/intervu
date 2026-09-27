#!/usr/bin/env node
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { linuxChromiumVisualQaLaunchOptions } from "./design/linux-chromium-visual-qa.cjs";

const require = createRequire(import.meta.url);
const AXE = require.resolve("axe-core/axe.min.js");

const OUT =
  process.argv[2] ||
  "/cursor/stores/bc-c68fc246-2df9-5e47-93dd-53b44f76f96f/media/polish/round2/batch-chrome-focus";
const BASE = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";

async function runAxeFull(page) {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async () => {
    const result = await globalThis.axe.run(document, {});
    return {
      violationCount: (result.violations || []).length,
      violations: (result.violations || []).map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes?.length ?? 0,
      })),
    };
  });
}

async function focusFirstTab(page) {
  const tab = page.locator('[data-mobile-tabbar] a').first();
  await tab.waitFor({ state: "visible" });
  await tab.focus();
  await page.waitForTimeout(200);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch(linuxChromiumVisualQaLaunchOptions());
  const page = await browser.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/jobs?posted=any`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForTimeout(800);

  await focusFirstTab(page);
  await page.evaluate(() => {
    document.querySelectorAll('[data-mobile-tabbar] a').forEach((el) => {
      el.classList.remove("designed-focus-ring");
    });
  });
  await page.screenshot({
    path: join(OUT, "before-mobile-tabbar-focus.png"),
    fullPage: false,
  });

  await page.goto(`${BASE}/jobs?posted=any`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForTimeout(800);
  await focusFirstTab(page);
  await page.screenshot({
    path: join(OUT, "after-mobile-tabbar-focus.png"),
    fullPage: false,
  });

  const axe = await runAxeFull(page);
  await writeFile(join(OUT, "axe-jobs-full.json"), JSON.stringify(axe, null, 2));
  console.log("axe", axe);

  await browser.close();
  if (axe.violationCount !== 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

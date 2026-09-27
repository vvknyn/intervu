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

const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

async function runAxeChromeRegions(page) {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async () => {
    const roots = [
      document.querySelector('[data-testid="topbar"]'),
      document.querySelector("[data-mobile-tabbar]"),
    ].filter(Boolean);
    const violations = [];
    for (const root of roots) {
      const result = await globalThis.axe.run(root);
      violations.push(...(result.violations || []));
    }
    const byId = new Map();
    for (const v of violations) {
      const prev = byId.get(v.id);
      if (prev) prev.nodes += v.nodes?.length ?? 0;
      else
        byId.set(v.id, {
          id: v.id,
          impact: v.impact,
          help: v.help,
          nodes: v.nodes?.length ?? 0,
        });
    }
    const merged = [...byId.values()];
    return { violationCount: merged.length, violations: merged };
  });
}

async function hideDevChrome(page) {
  await page.addStyleTag({
    content: `
      nextjs-portal,
      [data-nextjs-toast],
      [data-nextjs-dialog-overlay] {
        display: none !important;
        visibility: hidden !important;
      }
    `,
  });
}

async function stripDesignedFocusRing(page, selector) {
  await page.evaluate((sel) => {
    document.querySelectorAll(sel).forEach((el) => {
      el.classList.remove("designed-focus-ring");
    });
  }, selector);
}

async function scrollMobileTabBarIntoView(page) {
  await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  await page.waitForTimeout(150);
}

async function shotViewport(page, name, viewport) {
  await page.screenshot({
    path: join(OUT, name),
    clip: { x: 0, y: 0, width: viewport.width, height: viewport.height },
  });
}

async function focusTabBarLink(page, slug) {
  const selector = `[data-mobile-tabbar] a[data-testid="mobile-topbar-${slug}"], [data-mobile-tabbar] a[data-testid="mobile-${slug}"]`;
  await page.waitForSelector(selector, { state: "attached", timeout: 30_000 });
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!(el instanceof HTMLElement)) throw new Error(`missing tab link ${sel}`);
    el.focus();
  }, selector);
  await page.waitForTimeout(150);
}

async function captureMobileTabBar(browser) {
  const page = await browser.newPage();
  await page.setViewportSize(MOBILE);
  await page.goto(`${BASE}/jobs?posted=any`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForSelector('[data-testid="mobile-tabbar"]', { timeout: 120_000 });
  await page.waitForTimeout(800);
  await hideDevChrome(page);
  await scrollMobileTabBarIntoView(page);

  const tabSlugs = await page.locator("[data-mobile-tabbar] a").evaluateAll((links) =>
    links
      .map((el) => (el.getAttribute("data-testid") || "tab").replace(/^mobile-/, "").replace(/^topbar-/, ""))
      .filter(Boolean),
  );

  for (const slug of tabSlugs) {
    await page.goto(`${BASE}/jobs?posted=any`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForSelector('[data-testid="mobile-tabbar"]', { timeout: 120_000 });
    await page.waitForTimeout(500);
    await hideDevChrome(page);
    await scrollMobileTabBarIntoView(page);
    await stripDesignedFocusRing(page, "[data-mobile-tabbar] a");
    await focusTabBarLink(page, slug);
    await shotViewport(page, `before-mobile-tabbar-focus-${slug}.png`, MOBILE);

    await page.goto(`${BASE}/jobs?posted=any`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForSelector('[data-testid="mobile-tabbar"]', { timeout: 120_000 });
    await page.waitForTimeout(500);
    await hideDevChrome(page);
    await scrollMobileTabBarIntoView(page);
    await focusTabBarLink(page, slug);
    await shotViewport(page, `after-mobile-tabbar-focus-${slug}.png`, MOBILE);
  }

  const axe = await runAxeChromeRegions(page);
  await writeFile(join(OUT, "axe-jobs-mobile.json"), JSON.stringify(axe, null, 2));
  await page.close();
  return axe;
}

async function captureDesktopTopBar(browser) {
  const page = await browser.newPage();
  await page.setViewportSize(DESKTOP);
  await page.goto(`${BASE}/jobs?posted=any`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForSelector('[data-testid="topbar"]', { timeout: 120_000 });
  await page.waitForTimeout(800);
  await hideDevChrome(page);

  const targetTestIds = [
    "topbar-signin",
    "topbar-create-account",
    ...(await page.locator('[data-testid="topbar"] nav a').evaluateAll((links) =>
      links.map((el) => el.getAttribute("data-testid")).filter(Boolean),
    )),
  ];

  for (const testId of targetTestIds) {
    const slug = testId.replace(/^topbar-/, "");
    const jobsUrl = `${BASE}/jobs?posted=any`;
    const marketingUrl = `${BASE}/trends`;
    const pageUrl = testId === "topbar-create-account" ? marketingUrl : jobsUrl;

    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForSelector('[data-testid="topbar"]', { timeout: 120_000 });
    await page.waitForTimeout(500);
    await hideDevChrome(page);
    const locator = page.getByTestId(testId);
    if ((await locator.count()) === 0) continue;
    await stripDesignedFocusRing(page, '[data-testid="topbar"] nav a, [data-testid="topbar-signin"], [data-testid="topbar-create-account"]');
    await locator.focus();
    await page.waitForTimeout(150);
    await shotViewport(page, `before-desktop-topbar-focus-${slug}.png`, DESKTOP);

    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForSelector('[data-testid="topbar"]', { timeout: 120_000 });
    await page.waitForTimeout(500);
    await hideDevChrome(page);
    const locatorAfter = page.getByTestId(testId);
    if ((await locatorAfter.count()) === 0) continue;
    await locatorAfter.focus();
    await page.waitForTimeout(150);
    await shotViewport(page, `after-desktop-topbar-focus-${slug}.png`, DESKTOP);
  }

  const axe = await runAxeChromeRegions(page);
  await writeFile(join(OUT, "axe-jobs-desktop.json"), JSON.stringify(axe, null, 2));
  await page.close();
  return axe;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch(linuxChromiumVisualQaLaunchOptions());

  const mobileAxe = await captureMobileTabBar(browser);
  const desktopAxe = await captureDesktopTopBar(browser);

  await browser.close();

  console.log("mobile axe", mobileAxe);
  console.log("desktop axe", desktopAxe);
  console.log("captures written to", OUT);

  if (mobileAxe.violationCount !== 0 || desktopAxe.violationCount !== 0) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
import { linuxChromiumVisualQaLaunchOptions } from "./scripts/design/linux-chromium-visual-qa.cjs";

const launchOptions = linuxChromiumVisualQaLaunchOptions();

/**
 * Journey-regression suite. Reuses the base config's `use` (baseURL from
 * PLAYWRIGHT_BASE_URL, timeouts) and webServer behavior (no dev server when
 * PLAYWRIGHT_BASE_URL is set). Read-only by default: `@writes` journeys only run
 * with JOURNEYS_ALLOW_WRITES=1. See tests/journeys/CATALOG.md.
 */
export default defineConfig({
  ...base,
  testDir: "./tests/e2e/journeys",
  outputDir: "journeys-output",
  retries: 1,
  workers: 2,
  grepInvert: process.env.JOURNEYS_ALLOW_WRITES === "1" ? undefined : /@writes/,
  reporter: [
    ["list"],
    ["html", { outputFolder: "journeys-report", open: "never" }],
    ["json", { outputFile: "journeys-report/results.json" }],
  ],
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 }, launchOptions } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, launchOptions } },
  ],
});

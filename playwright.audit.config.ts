import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/**
 * Live recommendation audits (tests/e2e/audit). Desktop only, one worker:
 * each audit runs real searches under the per-IP search limit and paces
 * itself. Needs PLAYWRIGHT_BASE_URL (see `npm run audit:packs:prod`).
 */
export default defineConfig({
  ...base,
  testDir: "./tests/e2e/audit",
  testMatch: /.*\.audit\.ts$/,
  outputDir: "audit-output/playwright",
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  projects: [{ name: "desktop", use: { viewport: { width: 1440, height: 900 } } }],
});

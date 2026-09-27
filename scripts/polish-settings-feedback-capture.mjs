#!/usr/bin/env node
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { linuxChromiumVisualQaLaunchOptions } from "./design/linux-chromium-visual-qa.cjs";

const OUT =
  process.argv[2] ||
  "/cursor/stores/bc-c68fc246-2df9-5e47-93dd-53b44f76f96f/media/polish/round2/batch-settings-feedback";
const BASE = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";

const VIEWPORTS = [
  { tag: "desktop", width: 1440, height: 900 },
  { tag: "mobile", width: 390, height: 844 },
];

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch(linuxChromiumVisualQaLaunchOptions());

  for (const vp of VIEWPORTS) {
    const page = await browser.newPage();
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.addInitScript(() => {
      window.__INTERVU_E2E_AUTH__ = {
        uid: "fixture-settings-user",
        email: "fixture.settings@example.com",
        displayName: "Fixture User",
      };
    });
    await page.route("**/*", async (route) => {
      const req = route.request();
      if (req.method() === "POST" && req.headers()["next-action"]?.includes("listAgentCredentials")) {
        await route.fulfill({ status: 500, body: "simulated agent load failure" });
        return;
      }
      await route.continue();
    });
    await page.goto(`${BASE}/mock/settings?tab=account`, { waitUntil: "networkidle", timeout: 60_000 });
    await page.getByText(/Couldn't load your connected agents/i).waitFor({ timeout: 20_000 });
    await page.waitForTimeout(400);
    await page.screenshot({
      path: join(OUT, `settings-account-${vp.tag}.png`),
      fullPage: true,
    });
    await page.close();
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

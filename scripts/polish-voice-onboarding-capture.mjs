#!/usr/bin/env node
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { linuxChromiumVisualQaLaunchOptions } from "./design/linux-chromium-visual-qa.cjs";

const require = createRequire(import.meta.url);
const AXE = require.resolve("axe-core/axe.min.js");

const OUT =
    process.argv[2] ||
    "/cursor/stores/bc-c68fc246-2df9-5e47-93dd-53b44f76f96f/media/polish/round2/batch-voice-onboarding";
const BASE = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";

async function runAxe(page) {
    await page.addScriptTag({ path: AXE });
    return page.evaluate(async () => {
        const result = await globalThis.axe.run(document, {});
        return (result.violations || []).length;
    });
}

async function shot(page, name) {
    await page.screenshot({ path: join(OUT, name), fullPage: true });
}

async function main() {
    await mkdir(OUT, { recursive: true });
    const browser = await chromium.launch(linuxChromiumVisualQaLaunchOptions());

    for (const [tag, width, height] of [
        ["desktop", 1440, 900],
        ["mobile", 390, 844],
    ]) {
        const page = await browser.newPage();
        await page.setViewportSize({ width, height });

        await page.goto(`${BASE}/mock/empty-states?surface=history`, { waitUntil: "networkidle", timeout: 120_000 });
        await shot(page, `history-empty-${tag}.png`);

        await page.goto(`${BASE}/mock/email-nudge`, { waitUntil: "networkidle", timeout: 120_000 });
        await shot(page, `email-nudge-${tag}.png`);
        const violations = await runAxe(page);
        if (violations !== 0) {
            console.error(`axe violations on email-nudge (${tag}):`, violations);
            process.exitCode = 1;
        }

        await page.goto(`${BASE}/mock/onboarding`, { waitUntil: "networkidle", timeout: 120_000 });
        await page.getByRole("button", { name: "Step 2" }).click();
        await shot(page, `onboarding-step2-${tag}.png`);

        await page.close();
    }

    const historyPage = await browser.newPage();
    await historyPage.setViewportSize({ width: 390, height: 844 });
    await historyPage.goto(`${BASE}/yours/history`, { waitUntil: "networkidle", timeout: 120_000 });
    const signIn = historyPage.getByRole("button", { name: /Sign in/i }).first();
    await signIn.click();
    await historyPage.waitForTimeout(400);
    await historyPage.keyboard.press("Escape");
    await historyPage.waitForTimeout(200);
    const focused = await historyPage.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
    await shot(historyPage, "history-auth-focus-return-mobile.png");
    if (!/Sign in/i.test(focused)) {
        console.error("P2-11 focus did not return to opener; focused:", focused);
        process.exitCode = 1;
    }
    await historyPage.close();

    await browser.close();
    console.log("captures written to", OUT);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});

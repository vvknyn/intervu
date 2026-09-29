import { readFileSync } from "node:fs";
import path from "node:path";
import type { Page, Route } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * J-RESUME-28 — the résumé import never blocks on the on-device model: the
 * quick match opens at once, the model download reports real bytes against
 * the measured size, and the stages advance to an outcome (or a skip).
 * Read-only: the résumé is parsed in the browser and never leaves it.
 *
 * The model fetch is mocked (no 494 MB download): tokenizer.json answers at
 * once with a 3 MB body — real `progress_callback` bytes — and every other
 * model file answers 404 after HOLD_MS, so each engine attempt fails after a
 * visible download. WebGPU is hidden so the transformers.js engine (byte
 * progress) is the one exercised.
 */

const RESUME = readFileSync(path.join(__dirname, "../../fixtures/sample-resume.txt"));
const HOLD_MS = 5_000;
const FAKE_FILE = Buffer.alloc(3_000_000, 0x20);

async function mockModelHub(page: Page) {
    await page.addInitScript(() => Object.defineProperty(Navigator.prototype, "gpu", { get: () => undefined }));
    await page.route(
        (url) => url.hostname === "huggingface.co" || url.hostname.endsWith(".hf.co"),
        async (route: Route) => {
            const cors = { "access-control-allow-origin": "*" };
            if (new URL(route.request().url()).pathname.endsWith("/tokenizer.json")) {
                return route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: FAKE_FILE });
            }
            await new Promise((r) => setTimeout(r, HOLD_MS));
            return route.fulfill({ status: 404, headers: cors, body: "" }).catch(() => {});
        },
    );
}

async function startImport(page: Page) {
    await mockModelHub(page);
    await page.goto("/resume");
    await page.getByTestId("resume-signed-out-upload").click();
    const dialog = page.getByRole("dialog");
    await dialog.locator('input[type="file"]').setInputFiles({ name: "resume.txt", mimeType: "text/plain", buffer: RESUME });
    // Consent copy states the measured size before anything downloads.
    await expect(dialog.getByTestId("model-download-size")).toContainText("494 MB");
    await dialog.getByTestId("resume-import-parse-primary").click(); // "Download model & parse" — not skipped
    return { dialog, clickedAt: Date.now() };
}

test("résumé import: quick match at once, real model-download bytes, stages advance", { tag: ["@J-RESUME-28"] }, async ({ page, diagnostics }, testInfo) => {
    test.setTimeout(90_000);
    const { dialog, clickedAt } = await startImport(page);
    const shot = async (atMs: number) => {
        await page.waitForTimeout(Math.max(0, clickedAt + atMs - Date.now()));
        await page.screenshot({ path: testInfo.outputPath(`resume-wait-${testInfo.project.name}-t${atMs}ms.png`) });
    };
    await shot(500);

    // The quick (rules) match is on screen without waiting for the model.
    await expect(dialog.getByRole("button", { name: "Back" })).toBeVisible({ timeout: 10_000 });
    const strip = dialog.getByTestId("resume-model-strip");
    await expect(strip).toHaveAttribute("data-stage", "loading-model");
    const bytes = strip.getByTestId("model-load-progress-text");
    await expect(bytes).toHaveText(/^3 MB of 494 MB \(1%\)/);
    await expect(strip).toContainText("One-time download, cached for next time.");
    await expect(dialog.getByTestId("resume-model-skip")).toBeVisible();
    await shot(2_000);

    // The instruct model failed; the last-resort model has no measured size, so it says so.
    await expect(bytes).toHaveText(/^3 MB downloaded \(total size unknown\)/, { timeout: HOLD_MS + 10_000 });
    await shot(5_000);

    // Every engine failed → the quick match stays, and the strip says why.
    await expect(strip).toHaveAttribute("data-phase", "unimproved", { timeout: HOLD_MS + 10_000 });
    await expect(strip).toContainText("keeping the quick match");
    expect(diagnostics.pageErrors).toEqual([]);
});

test("résumé import: Skip keeps the quick match while the model is still downloading", { tag: ["@J-RESUME-28"] }, async ({ page, diagnostics }) => {
    const { dialog } = await startImport(page);
    const strip = dialog.getByTestId("resume-model-strip");
    await expect(strip.getByTestId("model-load-progress-text")).toHaveText(/MB of 494 MB/, { timeout: 10_000 });
    await dialog.getByTestId("resume-model-skip").click();
    await expect(strip).toHaveAttribute("data-phase", "skipped");
    await expect(strip).toContainText("Skipped — keeping the quick match.");
    await expect(dialog.getByRole("button", { name: "Back" })).toBeVisible();
    expect(diagnostics.pageErrors).toEqual([]);
});

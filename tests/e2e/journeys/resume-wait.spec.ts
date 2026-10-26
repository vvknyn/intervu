import type { Page } from "@playwright/test";
import { RESUME_IMPORT_SEALED_LINE } from "../../../src/lib/privacy-modes";
import { expect, test } from "./fixtures";

/**
 * J-RESUME-28 — the résumé import never blocks on sealed AI: the quick match
 * opens at once, sealed AI reads only what the quick read missed (without the
 * person's name or contact details), and the strip ends in an outcome or a
 * skip. Read-only: sealed AI is a stand-in here (src/lib/sealed-ai/client.ts);
 * Tinfoil itself can't be reached from a test.
 */

// One job and no skills section: a read the quick rules leave short, so sealed AI is asked to read it
// (a complete read never is, J-RESUME-51).
const RESUME = Buffer.from(`Priya Raman
priya.raman@example.com | Toronto, ON

WORK HISTORY
Northwind Logistics | Operations Lead | Mar 2019 – Present
Ran the overnight dispatch floor for 40 drivers and cut late deliveries by a third.
Rebuilt the weekly shift plan so every route had a backup driver.
`);
const HOLD_MS = 3_000;

/** Sealed AI on: records what it is sent, and answers `reply` after HOLD_MS (never, when null). */
async function sealedStandIn(page: Page, reply: string | null) {
    await page.addInitScript(
        ([answer, holdMs]) => {
            const w = window as unknown as { __sent: string[]; __velaiSealedAi: unknown };
            w.__sent = [];
            w.__velaiSealedAi = (messages: { content: string }[]) => {
                w.__sent.push(messages.map((m) => m.content).join("\n"));
                return answer === null ? new Promise(() => {}) : new Promise((resolve) => setTimeout(() => resolve(answer), holdMs as number));
            };
        },
        [reply, HOLD_MS] as const,
    );
}

async function startImport(page: Page) {
    await page.goto("/resume");
    await page.getByTestId("resume-signed-out-upload").click();
    const dialog = page.getByRole("dialog");
    // The sealed-AI line names Tinfoil's sealed hardware (Private cloud 2) in the open, with no extra tap.
    await expect(dialog.getByTestId("resume-import-model-on")).toContainText(RESUME_IMPORT_SEALED_LINE);
    await dialog.locator('input[type="file"]').setInputFiles({ name: "resume.txt", mimeType: "text/plain", buffer: RESUME });
    await dialog.getByTestId("resume-import-parse-primary").click();
    return dialog;
}

test("résumé import: quick match at once, sealed AI reads what it missed without contact details, and an answer it can't use keeps the quick match", { tag: ["@J-RESUME-28"] }, async ({ page, diagnostics }) => {
    await sealedStandIn(page, "Sorry, I can't help with that.");
    const dialog = await startImport(page);

    // The quick (rules) match is on screen without waiting for sealed AI.
    await expect(dialog.getByRole("button", { name: "Back" })).toBeVisible({ timeout: 10_000 });
    const strip = dialog.getByTestId("resume-model-strip");
    await expect(strip).toHaveAttribute("data-phase", "loading");
    await expect(strip).toContainText("Reading your résumé with sealed AI");
    await expect(dialog.getByTestId("resume-model-skip")).toBeVisible();

    const sent = await page.evaluate(() => (window as unknown as { __sent: string[] }).__sent);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Ran the overnight dispatch floor for 40 drivers");
    expect(sent[0]).not.toContain("Priya Raman");
    expect(sent[0]).not.toContain("priya.raman@example.com");

    await expect(strip).toHaveAttribute("data-phase", "unimproved", { timeout: HOLD_MS + 10_000 });
    await expect(strip).toContainText("keeping the quick match");
    await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue("Priya Raman");
    expect(diagnostics.pageErrors).toEqual([]);
});

test("résumé import: Skip keeps the quick match while sealed AI is still reading", { tag: ["@J-RESUME-28"] }, async ({ page, diagnostics }) => {
    await sealedStandIn(page, null);
    const dialog = await startImport(page);
    const strip = dialog.getByTestId("resume-model-strip");
    await expect(strip).toHaveAttribute("data-phase", "loading", { timeout: 10_000 });
    await dialog.getByTestId("resume-model-skip").click();
    await expect(strip).toHaveAttribute("data-phase", "skipped");
    await expect(strip).toContainText("Skipped — keeping the quick match.");
    await expect(dialog.getByRole("button", { name: "Back" })).toBeVisible();
    expect(diagnostics.pageErrors).toEqual([]);
});

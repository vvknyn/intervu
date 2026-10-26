import { test, expect } from "@playwright/test";

/** One count on the /jobs list head (fixtures: /mock/one-count). 37 fit + 12 ranked lower + 5 older roles left out. */

test("ranked head: one headline count covers the fit and ranked-lower roles; the line below counts only what was left out", async ({ page }) => {
    await page.goto("/mock/one-count");
    const ranked = page.getByTestId("mock-ranked");
    await expect(ranked.getByTestId("result-line")).toHaveText(/^49 roles/);
    const toggle = ranked.getByTestId("ranked-disclosure-toggle");
    await expect(toggle).toHaveText("5 left out");
    await expect(ranked).not.toContainText("Showing");
    await expect(ranked).not.toContainText("hidden");
    await expect(ranked).not.toContainText("ranked lower");
    await toggle.click();
    await expect(ranked.getByTestId("ranked-disclosure-panel")).toBeVisible();
    await expect(ranked.getByTestId("ranked-disclosure-panel")).not.toContainText("jump");
    await expect(ranked.getByTestId("ranked-disclosure-panel").getByRole("button")).not.toHaveCount(0);
});

test("freshest head: the visit fact is a suffix on the one count line, with the Job alert beside it", async ({ page }) => {
    await page.goto("/mock/one-count");
    const fresh = page.getByTestId("mock-fresh");
    const line = fresh.getByTestId("result-line");
    const visit = fresh.getByTestId("board-visit-banner");
    await expect(visit).toContainText("565 new since your last visit");
    // Same row, same baseline band: the suffix sits beside the count, not on a line above it.
    const [a, b, c] = await Promise.all([line.boundingBox(), visit.boundingBox(), fresh.getByTestId("mock-job-alert").boundingBox()]);
    expect(Math.abs(a!.y - b!.y)).toBeLessThan(a!.height);
    expect(Math.abs(a!.y - c!.y)).toBeLessThan(a!.height * 2);
});

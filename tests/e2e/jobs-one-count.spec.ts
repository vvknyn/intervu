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

test("freshest head: the visit fact is a suffix on the one count line from sm up, and gone below it", async ({ page }) => {
    await page.goto("/mock/one-count");
    const fresh = page.getByTestId("mock-fresh");
    const line = fresh.getByTestId("result-line");
    const visit = fresh.getByTestId("board-visit-banner");
    // Phone width has no room beside the count: the suffix goes rather than wrap under it (`VisitSince`).
    if ((page.viewportSize()?.width ?? 0) < 640) {
        await expect(visit).toBeHidden();
        return;
    }
    await expect(visit).toContainText("565 new since your last visit");
    // Same row, same baseline band: the suffix sits beside the count, not on a line above it.
    const [a, b] = await Promise.all([line.boundingBox(), visit.boundingBox()]);
    expect(Math.abs(a!.y - b!.y)).toBeLessThan(a!.height);
});

for (const state of ["mock-ranked", "mock-near", "mock-fresh"]) {
    test(`${state}: the Job alert switch sits on the count's row, at the row's right edge`, async ({ page }) => {
        await page.goto("/mock/one-count");
        const line = page.getByTestId(state).getByTestId("result-line");
        const [count, alert, row] = await Promise.all([
            line.boundingBox(),
            page.getByTestId(state).getByTestId("mock-job-alert").boundingBox(),
            line.locator("xpath=../..").evaluate((el) => {
                const box = el.getBoundingClientRect();
                return { right: box.right - parseFloat(getComputedStyle(el).paddingRight) };
            }),
        ]);
        expect(alert!.y).toBeGreaterThanOrEqual(count!.y - 1);
        expect(alert!.y).toBeLessThanOrEqual(count!.y + count!.height);
        expect(Math.abs(alert!.x + alert!.width - row.right)).toBeLessThanOrEqual(1);
    });
}

test("nothing-fits head: the count line claims only 'ranked by fit'; the closest-roles fact is the notice about the roles at the top", async ({ page }) => {
    await page.goto("/mock/one-count");
    const near = page.getByTestId("mock-near");
    await expect(near.getByTestId("result-line")).toHaveText("12 roles · ranked by fit");
    await expect(near.getByTestId("list-notice")).toContainText("the roles at the top are the closest");
});

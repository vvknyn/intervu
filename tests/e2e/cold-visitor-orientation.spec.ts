import { test, expect } from "@playwright/test";
import { COLD_ORIENTATION_DISMISSED_KEY } from "@/components/jobs/ColdVisitorOrientation";

test.describe("COLD-VISITOR-ORIENTATION — orientation banner introduces two paths to guest", () => {
    test("shows orientation banner with Search and Rank by fit, and dismisses on close button", async ({ page }) => {
        // Clear storage to simulate pristine guest
        await page.addInitScript((key) => {
            try {
                window.localStorage.removeItem(key as string);
                window.localStorage.removeItem("velai.localAi.enabled");
                window.localStorage.removeItem("velai.localAi.resume");
            } catch {}
        }, COLD_ORIENTATION_DISMISSED_KEY);

        await page.goto("/jobs");

        const banner = page.getByTestId("cold-visitor-orientation");
        await expect(banner).toBeVisible({ timeout: 15_000 });
        await expect(banner.getByText("Two ways to find your next role")).toBeVisible();
        await expect(banner.getByText("Search every live role")).toBeVisible();
        await expect(banner.getByTestId("orientation-rank-by-fit")).toBeVisible();

        // Dismiss banner
        await banner.getByRole("button", { name: "Dismiss welcome guide" }).click();
        await expect(banner).toHaveCount(0);

        // Reload page and confirm it stays dismissed
        await page.reload();
        await expect(page.getByTestId("cold-visitor-orientation")).toHaveCount(0);
    });

    test("clicking Rank by fit opens auth gate with personalized recommendation reason", async ({ page }) => {
        await page.addInitScript((key) => {
            try {
                window.localStorage.removeItem(key as string);
                window.localStorage.removeItem("velai.localAi.enabled");
                window.localStorage.removeItem("velai.localAi.resume");
            } catch {}
        }, COLD_ORIENTATION_DISMISSED_KEY);

        await page.goto("/jobs");

        const banner = page.getByTestId("cold-visitor-orientation");
        await expect(banner).toBeVisible({ timeout: 15_000 });

        await banner.getByTestId("orientation-rank-by-fit").click();

        const importDialog = page.getByRole("dialog");
        await expect(importDialog).toBeVisible({ timeout: 5000 });
        await expect(importDialog.getByText("Rank jobs by your résumé", { exact: false })).toBeVisible();
    });
});

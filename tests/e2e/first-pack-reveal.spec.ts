import { test, expect } from "@playwright/test";
import { FOR_YOU_DECK_MOCK_PATH, seedDeckMockHintDismissed, waitForMockDeckReady } from "./for-you-deck-mock.helpers";

test.describe("first pack reveal — mock fixture", () => {
    test("firstRevealEnter + focus lands on download/apply CTA", async ({ page }) => {
        await seedDeckMockHintDismissed(page);
        await page.goto(`${FOR_YOU_DECK_MOCK_PATH}?firstRevealEnter=1&firstRevealFocus=1`);
        await expect(page.getByTestId("for-you-deck")).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('[data-testid="for-you-deck"] .enter-reveal')).toBeVisible();
        await expect(page.getByTestId("for-you-download-apply")).toBeFocused({ timeout: 10_000 });
    });

    test("deck shell is ready without hub or session latch", async ({ page }) => {
        await waitForMockDeckReady(page);
        await expect(page.getByTestId("for-you-deck-position")).toContainText("1 of 3");
    });
});

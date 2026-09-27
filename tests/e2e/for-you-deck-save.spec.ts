import { test, expect } from "@playwright/test";
import { MOCK_FOR_YOU_SAVE_DELAY_MS } from "../../src/lib/jobs/for-you/mock-deck-fixtures";
import {
    seedDeckMockHintDismissed,
    waitForDeckRestingState,
    waitForMockDeckReady,
} from "./for-you-deck-mock.helpers";

test.describe("FOR-YOU-DECK — mock optimistic save", () => {
    test.beforeEach(async ({ page }) => {
        await seedDeckMockHintDismissed(page);
        await page.emulateMedia({ reducedMotion: "no-preference" });
    });

    test("shows optimistic filled bookmark then confirmed save without navigation", async ({ page }) => {
        await waitForMockDeckReady(page);

        const saveWrap = page.getByTestId("for-you-deck-save");
        await expect(saveWrap).toBeVisible();
        await expect(page.getByTestId("job-save-trigger")).toBeVisible();

        await page.getByTestId("job-save-trigger").click();

        await expect(page.getByTestId("job-save-optimistic")).toBeVisible({ timeout: 2_000 });
        await expect(page.getByTestId("job-save-trigger")).toHaveCount(0);

        await expect(page.getByTestId("job-save-confirmed")).toBeVisible({
            timeout: MOCK_FOR_YOU_SAVE_DELAY_MS + 2_000,
        });
        await waitForDeckRestingState(page);
    });
});

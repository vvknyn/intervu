import { expect, type Page } from "@playwright/test";
import { FOR_YOU_HINT_DISMISSED_KEY } from "../../src/lib/jobs/for-you/first-run-hint";

export const FOR_YOU_DECK_MOCK_PATH = "/mock/for-you-deck";

/** Dismiss the deck first-run hint unless a test explicitly covers it. */
export async function seedDeckMockHintDismissed(page: Page) {
    await page.addInitScript((key: string) => {
        try {
            window.localStorage.setItem(key, "1");
        } catch {
            /* private mode */
        }
    }, FOR_YOU_HINT_DISMISSED_KEY);
}

export function packIdentity(page: Page) {
    return page.getByTestId("for-you-pack").locator("h2").innerText();
}

export async function waitForMockDeckReady(page: Page) {
    await page.goto(FOR_YOU_DECK_MOCK_PATH);
    await expect(page.getByTestId("for-you-deck-mock-root")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("for-you-home")).toBeVisible();
    await expect(page.getByTestId("for-you-deck")).toBeVisible();
    await expect(page.getByTestId("for-you-pack").first()).toBeVisible();
}

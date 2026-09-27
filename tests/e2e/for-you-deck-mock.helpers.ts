import { expect, type Locator, type Page } from "@playwright/test";
import { FOR_YOU_HINT_DISMISSED_KEY } from "../../src/lib/jobs/for-you/first-run-hint";

export const FOR_YOU_DECK_MOCK_PATH = "/mock/for-you-deck";

/** Deck commit uses `--transition-deck` (220ms); poll budget covers crossfade out+in. */
const DECK_REST_POLL_TIMEOUT_MS = 12_000;

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

/** Ensure the hint can show — runs after any dismiss seed; remove wins on navigation. */
export async function seedDeckMockHintCleared(page: Page) {
    await page.addInitScript((key: string) => {
        try {
            window.localStorage.removeItem(key);
        } catch {
            /* private mode */
        }
    }, FOR_YOU_HINT_DISMISSED_KEY);
}

/** Single resting card: idle deck shell (no commit layers) and exactly one pack h2. */
export function deckRestingPack(page: Page): Locator {
    return page
        .locator('[data-testid="for-you-deck"]')
        .filter({ hasNot: page.locator("[data-deck-role]") })
        .getByTestId("for-you-pack");
}

export function deckRestingPackHeading(page: Page): Locator {
    return deckRestingPack(page).locator("h2");
}

export async function waitForDeckRestingState(page: Page, timeout = DECK_REST_POLL_TIMEOUT_MS): Promise<void> {
    const heading = deckRestingPackHeading(page);
    await expect(heading, "deck must settle to one resting pack").toHaveCount(1, { timeout });
    await expect(heading).toBeVisible({ timeout });
}

export async function restingPackTitle(page: Page): Promise<string> {
    await waitForDeckRestingState(page);
    return deckRestingPackHeading(page).innerText();
}

/** @deprecated alias — always waits for resting single-card DOM. */
export async function packIdentity(page: Page): Promise<string> {
    return restingPackTitle(page);
}

export async function waitForMockDeckReady(page: Page) {
    await page.goto(FOR_YOU_DECK_MOCK_PATH);
    await expect(page.getByTestId("for-you-deck-mock-root")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("for-you-home")).toBeVisible();
    await expect(page.getByTestId("for-you-deck")).toBeVisible();
    await waitForDeckRestingState(page);
}

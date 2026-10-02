import type { Locator, Page } from "@playwright/test";

/**
 * Runs the search typed into `input`, as the visitor would. From sm up Search
 * sits beside the fields and is clicked. On a phone it sits under the two
 * fields, where the suggestions list that opens as you type covers it, so the
 * search runs from the keyboard's Go (Enter), as phone searches do.
 */
export async function runSearch(page: Page, input: Locator) {
    if (page.viewportSize()!.width < 640) await input.press("Enter");
    else await page.getByTestId("search-submit").click();
}

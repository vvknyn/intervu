import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * Journeys for what a search box runs on Enter, a pick and a tap — see
 * tests/journeys/CATALOG.md (J-SRCH-38 to 40). Read-only.
 *
 * The rule: Enter searches the words in the box. A suggestion runs only when
 * the person picked it, with the arrow keys or a click or tap. A pointer
 * resting over the list never picks one (the front door's phone list opened
 * under the pointer left after "Upload résumé", and Enter ran the suggestion
 * under it instead of the typed words).
 */

const SEARCH_BOX = "Job title, skill, or company";
/** Three letters short of the seeded and live titles ("Accountant"), so a suggestion's text is never the typed text. */
const TYPED = "account";
const RESUME_BAND = 'section[aria-label="Add your resume"]';

async function openFrontDoor(page: Page) {
  await page.goto("/jobs");
  // Interact once the page's code has run (a click before hydration does nothing).
  await page.waitForLoadState("networkidle");
  return page.getByPlaceholder(SEARCH_BOX).first();
}

/** The search the page ran, read from the address bar. */
const searched = (page: Page) => new URL(page.url()).searchParams.get("q");

test.describe("the search box", () => {
  test("searches the words typed when the pointer rests over a suggestion; hovering one picks nothing", { tag: ["@J-SRCH-38"] }, async ({ page, diagnostics }) => {
    const input = await openFrontDoor(page);

    // An empty, focused box lists popular searches. Park the pointer on the first.
    await input.click();
    const options = page.getByRole("option");
    await expect(options.first()).toBeVisible();
    const seed = (await options.first().boundingBox())!;
    const parked = { x: seed.x + seed.width / 2, y: seed.y + seed.height / 2 };
    await page.mouse.move(parked.x, parked.y);
    await expect(options.first(), "hovering a suggestion picks nothing").toHaveAttribute("aria-selected", "false");

    // Type with the pointer still there. Enter at once, while the list still shows the old suggestions.
    await page.keyboard.press("Escape");
    await input.fill(TYPED);
    await input.press("Enter");
    await expect(page).toHaveURL(/\/jobs\?(.+&)?q=/);
    expect(searched(page), "Enter right after typing, pointer over a suggestion").toBe(TYPED);

    // Same again once the typed words' own suggestions are listed under the pointer.
    await input.fill("");
    await input.fill(TYPED);
    await expect(options.first()).toContainText(/account/i);
    await page.mouse.move(parked.x, parked.y + 1);
    await expect(options.first(), "a list drawn under the pointer picks nothing").toHaveAttribute("aria-selected", "false");
    await input.press("Enter");
    await expect(page).toHaveURL(new RegExp(`q=${TYPED}(&|$)`));
    expect(searched(page), "Enter with the typed words' suggestions under the pointer").toBe(TYPED);
    expect(diagnostics.serverErrors).toEqual([]);
  });

  test("runs the suggestion that was picked with the arrow keys, or clicked or tapped", { tag: ["@J-SRCH-39"] }, async ({ page, diagnostics }) => {
    const input = await openFrontDoor(page);
    const options = page.getByRole("option");

    await input.fill(TYPED);
    await expect(options.first()).toContainText(/account/i);
    const first = (await options.first().innerText()).trim();
    expect(first.toLowerCase(), "a suggestion is a longer title than the typed words").not.toBe(TYPED);

    await input.press("ArrowDown");
    await expect(options.first()).toHaveAttribute("aria-selected", "true");
    await input.press("Enter");
    await expect(page).toHaveURL(/\/jobs\?(.+&)?q=/);
    expect(searched(page), "arrow key then Enter").toBe(first);

    // A click or tap on a suggestion runs it too.
    await input.fill("");
    await input.fill(TYPED);
    await expect(options.first()).toContainText(/account/i);
    const second = (await options.first().innerText()).trim();
    await options.first().click();
    await expect.poll(() => searched(page), "click on a suggestion").toBe(second);
    expect(diagnostics.serverErrors).toEqual([]);
  });

  test("closing the résumé dialog puts focus back on the button that opened it", { tag: ["@J-SRCH-40"] }, async ({ page, diagnostics }) => {
    await openFrontDoor(page);
    const upload = page.locator(RESUME_BAND).getByRole("button", { name: "Upload résumé" });
    await upload.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("resume-import-parse-primary")).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    // Not on the page body, where the next key press goes nowhere.
    await expect(upload).toBeFocused();
    expect(diagnostics.pageErrors).toEqual([]);
  });
});

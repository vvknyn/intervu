import { expect, test } from "./fixtures";

/**
 * Journeys for the company page's numbers (/co/[slug]): each stat says what
 * it counts, and nothing on the page states a figure it can't back. See
 * tests/journeys/CATALOG.md (J-COMPANY-35 to J-COMPANY-38). Read-only.
 */

const COMPANY = "/co/anthropic--com";

test("the hiring headline states the open-role count on Velai, with no 'Yes —' and no lowercase velai", { tag: ["@J-COMPANY-35"] }, async ({ page }) => {
    await page.goto(COMPANY);
    const headline = page.getByTestId("company-hiring-headline");
    await expect(headline).toBeVisible({ timeout: 30_000 });
    const text = (await headline.textContent())?.trim() ?? "";
    expect(text).toMatch(/^(\d[\d,]*\+? open roles? live on Velai right now|Velai isn't tracking any live open roles right now)/);
    expect(text).not.toMatch(/\bYes\b|—|\bvelai\b/);
    // The live check, when printed, is a count (or "all") seen in the past week.
    const rest = text.split(" · ")[1];
    if (rest) expect(rest).toMatch(/^(all|\d[\d,]*) seen live in the past week$/);
});

test("the remote fact is a count by work type and opens the matching Remote search on /jobs", { tag: ["@J-COMPANY-36"] }, async ({ page }) => {
    await page.goto(COMPANY);
    await expect(page.getByTestId("company-hiring-headline")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("company-page")).not.toContainText(/\b\d+% of roles remote/);
    const remote = page.getByTestId("company-remote-share");
    test.skip((await remote.count()) === 0, "no remote roles at this employer right now");
    await expect(remote).toHaveText(/^(\d[\d,]* of \d[\d,]* roles remote|about \d+% of roles remote)$/);
    const href = (await remote.getAttribute("href")) ?? "";
    expect(href).toMatch(/^\/jobs\?/);
    expect(href).toContain("anthropic.com");
    expect(decodeURIComponent(href).toLowerCase()).toContain("remote");
    await remote.click();
    await expect(page).toHaveURL(/\/jobs\?/);
    await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 30_000 });
});

test("the posting chart prints each week's count, marks this week in progress and draws no week before tracking as a zero", { tag: ["@J-COMPANY-37"] }, async ({ page }) => {
    await page.goto(COMPANY);
    await expect(page.getByTestId("company-hiring-headline")).toBeVisible({ timeout: 30_000 });
    const strip = page.getByTestId("company-cadence-strip");
    test.skip((await strip.count()) === 0, "no posting history for this employer on the box");
    const weeks = strip.getByTestId("company-cadence-week");
    const n = await weeks.count();
    expect(n).toBeGreaterThan(0);
    // Only the last week is in progress.
    await expect(weeks.nth(n - 1)).toHaveAttribute("data-in-progress", "true");
    await expect(strip.locator("[data-in-progress]")).toHaveCount(1);
    // The first tracked week, when inside the window, is the first bar drawn.
    const firstTracked = strip.locator("[data-first-tracked]");
    const tracked = await firstTracked.count();
    expect(tracked).toBeLessThanOrEqual(1);
    if (tracked === 1) {
        await expect(weeks.first()).toHaveAttribute("data-first-tracked", "true");
        await expect(strip).toContainText("tracking since");
        await expect(strip).toContainText("First week tracked: includes roles already open");
    }
    // Counts are printed, not hover-only: every week with postings shows its number.
    const labels = await weeks.evaluateAll((els) =>
        els.map((el) => ({ title: el.getAttribute("title") ?? "", shown: el.textContent?.trim() ?? "" })),
    );
    for (const { title, shown } of labels) {
        const count = Number(title.match(/^(\d+)/)?.[1] ?? "0");
        if (count > 0) expect(shown).toBe(String(count));
    }
    // No bar sizes itself with an inline style (design language).
    await expect(strip.locator("[style]")).toHaveCount(0);
});

test("the page gives one answer to 'is this company hiring?' and no undefined health score", { tag: ["@J-COMPANY-38"] }, async ({ page }) => {
    await page.goto(COMPANY);
    await expect(page.getByTestId("company-hiring-headline")).toBeVisible({ timeout: 30_000 });
    const body = page.getByTestId("company-page");
    await expect(body).not.toContainText("Are they actually hiring?");
    await expect(body).not.toContainText(/health score/i);
    // "Active" is true of every employer with live roles; only an unusual status shows.
    await expect(page.getByTestId("company-verdict-band").getByText("Active", { exact: true })).toHaveCount(0);
});

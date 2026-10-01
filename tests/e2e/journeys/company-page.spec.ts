import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * Journeys for the company page's numbers (/co/[slug]): each stat says what
 * it counts, and nothing on the page states a figure it can't back; and its
 * first screen holds roles. See tests/journeys/CATALOG.md (J-COMPANY-35 to
 * J-COMPANY-42). Read-only, apart from J-COMPANY-18's @writes test.
 */

const COMPANY = "/co/anthropic--com";
const OTHER_COMPANY = "/co/openai--com";
/** A smaller employer, for figures that only show when every open role is
 *  fetched (the stat row is census-gated). */
const SMALLER_COMPANIES = ["/co/1password--com", "/co/outerboxdesign--com"];

/**
 * Opens a company page and waits for it to settle. Every page remounts once
 * after load, when `DeferredAuthKitProvider` swaps in the auth provider, and
 * a count or a skip read before that can see an empty page.
 */
async function openCompany(page: Page, path = COMPANY) {
    const response = await page.goto(path);
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    return response;
}

test("the hiring headline states the open-role count on Velai, with no 'Yes —' and no lowercase velai", { tag: ["@J-COMPANY-35"] }, async ({ page }) => {
    await openCompany(page);
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
    await openCompany(page);
    await expect(page.getByTestId("company-hiring-headline")).toBeVisible({ timeout: 30_000 });
    // A bare share ("3% of roles remote") is the old title-match stat; over a sample of a
    // big employer's roles the fact is a rounded share and says so ("about 3% of roles remote").
    await expect(page.getByTestId("company-page")).not.toContainText(/(?<!about )\b\d+% of roles remote/);
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
    await openCompany(page);
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
    await openCompany(page);
    await expect(page.getByTestId("company-hiring-headline")).toBeVisible({ timeout: 30_000 });
    const body = page.getByTestId("company-page");
    await expect(body).not.toContainText("Are they actually hiring?");
    await expect(body).not.toContainText(/health score/i);
    // "Active" is true of every employer with live roles; only an unusual status shows.
    await expect(page.getByTestId("company-verdict-band").getByText("Active", { exact: true })).toHaveCount(0);
});

// Runs at both project sizes (desktop 1440x900, mobile 390x844).
test("the first screen shows an open role, and a phone reaches the roles before the hiring record rail", { tag: ["@J-COMPANY-39"] }, async ({ page }) => {
    const viewport = page.viewportSize();
    expect(viewport, "the project sets a viewport").not.toBeNull();
    await openCompany(page);
    await expect(page.getByTestId("company-hiring-headline")).toBeVisible({ timeout: 30_000 });
    const firstRole = page.getByTestId("company-role-row").first();
    await expect(firstRole).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => (await firstRole.boundingBox())?.y ?? Infinity).toBeLessThan(viewport!.height);
    if (viewport!.width < 1024) {
        const role = await firstRole.boundingBox();
        const rail = await page.getByTestId("company-rail").boundingBox();
        if (role && rail) expect(rail.y).toBeGreaterThan(role.y);
    }
});

test("each role row says how old the posting is in its right rail, not a bare 'View'", { tag: ["@J-COMPANY-40"] }, async ({ page }) => {
    await openCompany(page);
    const rows = page.getByTestId("company-role-row");
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });
    const ages = await page.getByTestId("company-role-age").allTextContents();
    expect(ages.length).toBeGreaterThan(0);
    for (const age of ages) expect(age.trim()).toMatch(/^(|today|\d+d ago|\d+mo ago|\d+y ago)$/);
    expect(ages.some((a) => a.trim() !== "")).toBe(true);
    await expect(page.getByTestId("company-role-search").getByText("View", { exact: true })).toHaveCount(0);
});

test("the stat row counts the company's own open roles, each figure with its label", { tag: ["@J-COMPANY-41"] }, async ({ page }) => {
    // Census-gated: an employer with more open roles than the page fetches shows no row.
    await openCompany(page);
    await expect(page.getByTestId("company-hiring-headline")).toBeVisible({ timeout: 30_000 });
    let statRow = page.getByTestId("company-role-stats");
    for (const company of SMALLER_COMPANIES) {
        if ((await statRow.count()) > 0) break;
        const response = await openCompany(page, company);
        if (!response || response.status() >= 400) continue;
        await expect(page.getByTestId("company-page")).toBeVisible({ timeout: 30_000 });
        statRow = page.getByTestId("company-role-stats");
    }
    test.skip((await statRow.count()) === 0, "no employer tried has every open role fetched right now");
    const text = (await statRow.textContent()) ?? "";
    // Roles with pay are always counted over the company's open roles.
    expect(text).toMatch(/\d[\d,]* of \d[\d,]*list pay/);
    expect(text).not.toMatch(/NaN|undefined|null/);
    // Any typical pay is a yearly range in one currency, never a converted hourly rate.
    if (text.includes("typical listed pay")) expect(text).toMatch(/[A-Z]{3} [\d.]+[kM]?(–[\d.]+[kM]?)?\/yrtypical listed pay/);
});

test("a signed-out visitor gets the site's one sign-up gate, back to this company, and no follow lock card", { tag: ["@J-COMPANY-42"] }, async ({ page }) => {
    await openCompany(page);
    await expect(page.getByTestId("company-hiring-headline")).toBeVisible({ timeout: 30_000 });
    const gate = page.getByTestId("company-exhaust-gate");
    test.skip((await gate.count()) === 0, "no box hiring record for this employer right now");
    const create = gate.getByTestId("signup-gate-create");
    await expect(create).toBeVisible();
    expect(decodeURIComponent((await create.getAttribute("href")) ?? "")).toContain("/co/anthropic--com");
    await expect(gate.getByTestId("signup-gate-signin")).toBeVisible();
    // One ask per visitor: no hand-rolled sign-in button and no second, follow-only card.
    await expect(page.getByText("Sign in to open the record")).toHaveCount(0);
    await expect(page.getByText("Followers only", { exact: true })).toHaveCount(0);
});

// J-COMPANY-18: a signed-out visitor who verified their email follows a company
// with one click; opening a page only reads whether they follow it (a read
// after load, which openCompany's network-idle wait covers).

test("the verify link's ?followed=1 is used once, so a reload doesn't bring back a follow", { tag: ["@J-COMPANY-18"] }, async ({ page }) => {
    await openCompany(page, `${COMPANY}?followed=1`);
    await expect(page).not.toHaveURL(/followed=1/);
    await page.reload();
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await expect(page.getByTestId("follow-company").first()).toHaveAttribute("data-following", "false", { timeout: 30_000 });
    await expect(page.getByTestId("follow-email-verified")).toHaveCount(0);
});

test("a verified guest's follow is one click, opening pages never follows, and Unfollow survives a reload", { tag: ["@J-COMPANY-18", "@writes"] }, async ({ page, context, baseURL }) => {
    const token = process.env.JOURNEY_CONTACT_TOKEN;
    test.skip(!token || !baseURL, "needs JOURNEY_CONTACT_TOKEN, the contact token of a verified guest identity seeded for journeys");
    await context.addCookies([{ name: "intervu_contact", value: token!, url: baseURL! }]);
    const follow = page.getByTestId("follow-company").first();

    // Start from not following, in case an earlier run stopped halfway.
    await openCompany(page, COMPANY);
    await expect(follow).toBeEnabled({ timeout: 30_000 });
    if ((await follow.getAttribute("data-following")) === "true") {
        await follow.click();
        await expect(follow).toHaveAttribute("data-following", "false");
    }

    // Opening the page again doesn't follow it.
    await openCompany(page, COMPANY);
    await expect(follow).toHaveAttribute("data-following", "false", { timeout: 30_000 });

    // One click follows, with no email step: this browser is already verified.
    await follow.click();
    await expect(follow).toHaveAttribute("data-following", "true");
    await expect(page.getByTestId("follow-email-step")).toHaveCount(0);
    await expect(page.getByTestId("follow-email-verified").first()).toBeVisible();
    await openCompany(page, COMPANY);
    await expect(follow).toHaveAttribute("data-following", "true", { timeout: 30_000 });

    // Unfollow holds after a reload.
    await follow.click();
    await expect(follow).toHaveAttribute("data-following", "false");
    await openCompany(page, COMPANY);
    await expect(follow).toHaveAttribute("data-following", "false", { timeout: 30_000 });

    // Another company isn't followed by opening its page.
    await openCompany(page, OTHER_COMPANY);
    await expect(follow).toHaveAttribute("data-following", "false", { timeout: 30_000 });
});

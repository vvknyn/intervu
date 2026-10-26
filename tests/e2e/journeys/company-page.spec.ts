import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { actionObject, signInLikeProduction } from "./signed-in";

/**
 * Journeys for the company page's numbers (/co/[slug]): each stat says what
 * it counts, and nothing on the page states a figure it can't back; and its
 * first screen holds roles. See tests/journeys/CATALOG.md (J-COMPANY-35 to
 * J-COMPANY-42). Read-only, apart from J-COMPANY-18's @writes test.
 */

const COMPANY = "/co/anthropic--com";
const OTHER_COMPANY = "/co/openai--com";

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
        await expect(strip).not.toContainText("tracking since");
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

test("the stat row carries no posted-recently tile and no broken figure", { tag: ["@J-COMPANY-41"] }, async ({ page }) => {
    // Census-gated: an employer with more open roles than the page fetches shows no row.
    await openCompany(page);
    await expect(page.getByTestId("company-hiring-headline")).toBeVisible({ timeout: 30_000 });
    // The old "new in the last N days" tile counted a third definition of "new"; the figures
    // left are the résumé fit (signed-in) and the page's one hiring record.
    await expect(page.getByTestId("company-page")).not.toContainText(/new in the last \d+ days/);
    const statRow = page.getByTestId("company-role-stats");
    if ((await statRow.count()) > 0) expect((await statRow.textContent()) ?? "").not.toMatch(/NaN|undefined|null/);
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

test("a signed-in person's Follow follows from the account in one click, with no email step", { tag: ["@J-COMPANY-46"] }, async ({ page, diagnostics }) => {
    // Signed in the way production signs in, Follow took the guest path and
    // asked for an email (founder report 2026-10-01, same cause as the
    // tracker's "Could not find this pursuit."). Lists answer empty; the
    // follow itself is recorded, not written.
    const follows: Record<string, unknown>[] = [];
    await signInLikeProduction(page, (args) => {
        if (args.length === 0) return { data: [] };
        const input = actionObject(args[0]);
        if (args.length === 1 && typeof input.domain === "string" && "slug" in input) {
            follows.push(input);
            return {};
        }
        return undefined;
    });
    await openCompany(page, COMPANY);
    // The header's account menu shows once the session check has answered.
    await expect(page.getByTestId("topbar-avatar")).toBeVisible({ timeout: 30_000 });
    const follow = page.getByTestId("follow-company").first();
    await expect(follow).toHaveAttribute("data-following", "false", { timeout: 30_000 });
    await follow.click();
    await expect(follow).toHaveAttribute("data-following", "true");
    await expect(page.getByTestId("follow-email-step")).toHaveCount(0);
    await expect.poll(() => follows).toEqual([expect.objectContaining({ domain: "anthropic.com" })]);
    expect(diagnostics.pageErrors).toEqual([]);
    await page.unrouteAll({ behavior: "ignoreErrors" });
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

/** Vivek's budget (2026-09-30): every search and list renders in under 2 s. */
const ROLES_BUDGET_MS = 2_000;

// Big employers are the slowest pages to answer: Amazon's first load took
// 4.3 s on release 16, behind its slower side reads (box database, news,
// recent changes), which the page no longer waits on past its own search.
for (const path of [COMPANY, "/co/amazon--com"]) {
    test(`${path} shows its first roles within 2 seconds`, { tag: ["@J-COMPANY-47"] }, async ({ page }) => {
        const startedAt = Date.now();
        await page.goto(path, { waitUntil: "commit" });
        const role = page.getByTestId("company-role-row").first();
        const missing = page.getByRole("heading", { name: "Page not found" });
        await expect(role.or(missing)).toBeVisible({ timeout: 15_000 });
        const elapsed = Date.now() - startedAt;
        test.skip(await missing.isVisible(), `${path} has no company page here`);

        test.info().annotations.push({ type: "roles-ms", description: `${path} ${elapsed}` });
        expect(elapsed, `${path} showed its roles after ${elapsed} ms`).toBeLessThan(ROLES_BUDGET_MS);
    });
}

// A logo whose image fails before the page's code has run (a blocked or
// unreachable logo) used to stay a broken image with its alt text:
// React's onError only hears failures after hydration.
test("a logo that fails before the page is interactive shows the letter tile, not a broken image", { tag: ["@J-COMPANY-48"] }, async ({ page }) => {
    let logoFailed = () => {};
    const failed = new Promise<void>((resolve) => (logoFailed = resolve));
    await page.route(/\/logos\/[^/]+\.png/, async (route) => {
        await route.abort();
        logoFailed();
    });
    // The page's code waits until the logo has failed, so the failure lands
    // before hydration (capped, in case a page asks for no logo at all).
    await page.route(/\/_next\/static\/chunks\/.+\.js(\?.*)?$/, async (route) => {
        await Promise.race([failed.then(() => page.waitForTimeout(300)), page.waitForTimeout(5_000)]);
        await route.continue().catch(() => {});
    });

    await openCompany(page);
    const header = page.getByTestId("company-page").locator("header").first();
    await expect(header).toBeVisible({ timeout: 30_000 });
    // React has attached to the server-rendered header, so the check after
    // hydration has had its chance.
    await expect
        .poll(() => header.evaluate((el) => Object.keys(el).some((key) => key.startsWith("__reactFiber"))), { timeout: 15_000 })
        .toBe(true);

    await expect(header.getByTestId("company-logo-tile")).toBeVisible();
    await expect(header.getByRole("img", { name: /logo$/ })).toHaveCount(0);
});

/** Fabricated candidate (no real person), for J-COMPANY-49. */
const FIT_RESUME = [
    "Riley Morgan",
    "Software Engineer",
    "riley.morgan.e2e@example.com | Toronto, Ontario, Canada | 416-555-0199",
    "",
    "EXPERIENCE",
    "Software Engineer, Northwind Systems",
    "2019 - Present",
    "- Built and ran backend services in TypeScript and Python.",
    "",
    "Registered Nurse, Lakeshore Health",
    "2014 - 2019",
    "- Cared for patients on a medical-surgical unit.",
    "",
    "EDUCATION",
    "B.Sc. Computer Science, University of Toronto, 2014",
    "",
    "SKILLS",
    "TypeScript, Python, PostgreSQL, Patient Care",
].join("\n");

// Google visitors to company pages mostly left without a click (PostHog, 30
// days to 2026-10-07). The page now asks the one question Velai can answer
// there, and answers it in place. Read-only: a guest's résumé is parsed and
// scored in the browser and kept in this browser only.
test("a visitor with no résumé is asked which roles fit them, and adding one ranks this list in place", { tag: ["@J-COMPANY-49"] }, async ({ page, diagnostics }) => {
    await openCompany(page);
    const prompt = page.getByTestId("company-fit-prompt");
    await expect(prompt).toBeVisible({ timeout: 30_000 });
    await expect(prompt).toContainText(/^(Which of these \d+ roles|Which of the \d+ newest roles here|Does this open role) fit you\?/);
    await expect(prompt).toContainText("stays on this device. The file is never uploaded.");
    // Asked before the roles it is about.
    const firstRole = page.getByTestId("company-role-row").first();
    expect((await prompt.boundingBox())!.y).toBeLessThan((await firstRole.boundingBox())!.y);

    await prompt.getByRole("button", { name: "Check my fit" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator('input[type="file"]').setInputFiles({ name: "riley.txt", mimeType: "text/plain", buffer: Buffer.from(FIT_RESUME) });
    await dialog.getByTestId("resume-import-parse-primary").click();
    await dialog.getByRole("button", { name: "Rank these roles" }).click({ timeout: 30_000 });
    await expect(dialog).toHaveCount(0);

    // Answered on this page: no ask, the list best fit first, each role labelled.
    await expect(prompt).toHaveCount(0);
    const roles = page.getByTestId("company-role-search");
    await expect(roles).toContainText("Best fit first");
    await expect(page.getByTestId("company-role-stats")).toContainText(/strong fit for your résumé|strong fits among the \d+ newest/);
    await expect(roles.getByTestId("match-chip").first()).toBeVisible();
    await expect(page).toHaveURL(/\/co\//);

    // Kept in this browser: the next visit is ranked without asking again.
    await page.reload();
    await expect(page.getByTestId("company-role-stats")).toContainText(/strong fit for your résumé|strong fits among the \d+ newest/, { timeout: 30_000 });
    await expect(page.getByTestId("company-fit-prompt")).toHaveCount(0);
    expect(diagnostics.pageErrors).toEqual([]);
});

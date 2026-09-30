import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * Changing a tracked role's status, and the full pursuit page (/yours/[id])
 * it lives on at xl+ — see tests/journeys/CATALOG.md (J-TRACKER-*). Guest
 * pursuits are seeded in localStorage before the first load, so nothing here
 * needs an account or writes to the server.
 *
 * Founder report 2026-09-30: a role marked Applied could not be moved to
 * Rejected. The full page had no status control ("Applied" was plain text),
 * and the sheet's one "Closed" button wrote withdrawn, so no surface could
 * record a rejection.
 */

const GUEST_PURSUITS_KEY = "intervu.pursuits.guest";

// Ashby stores literal Markdown; the page printed it raw ("***1Password is growing**").
const DESCRIPTION =
    "***1Password is growing** We've surpassed $400M in ARR.\n\n## **What you'll do**\n\n- Lead a team of solutions engineers\n- Coach the team on technical discovery";

type Status = "interested" | "applied" | "interviewing" | "offer" | "rejected" | "withdrawn";

function guestPursuit(id: string, status: Status, extra: Record<string, unknown> = {}) {
    const now = new Date().toISOString();
    return {
        id,
        user_id: "guest",
        company_name: "1password",
        position: "Manager, Solutions Engineering, MM",
        status,
        job_id: `job-${id}`,
        job_snapshot: {
            title: "Manager, Solutions Engineering, MM",
            company: "1password",
            location: "Remote (United States | Canada)",
            description: DESCRIPTION,
            apply_url: "https://example.com/jobs/1",
        },
        job_url: "https://example.com/jobs/1",
        created_at: now,
        updated_at: now,
        ...(status === "applied" ? { applied_at: now } : {}),
        ...extra,
    };
}

/** Seeds once per tab: a reload must read what the page saved, not the seed again. */
async function seed(page: Page, pursuits: ReturnType<typeof guestPursuit>[]) {
    await page.addInitScript(
        ([key, rows]) => {
            if (sessionStorage.getItem("journey-seeded")) return;
            localStorage.setItem(key as string, JSON.stringify(rows));
            sessionStorage.setItem("journey-seeded", "1");
        },
        [GUEST_PURSUITS_KEY, pursuits] as const,
    );
}

const HYDRATION = /hydrat|#418|#423|#425/i;

const statusRow = (page: Page) => page.getByRole("group", { name: "Status" });
const statusButton = (page: Page, name: string) => statusRow(page).getByRole("button", { name, exact: true });

async function expectPressed(page: Page, name: string) {
    await expect(statusButton(page, name)).toHaveAttribute("aria-pressed", "true", { timeout: 15_000 });
    await expect(statusRow(page).locator('[aria-pressed="true"]')).toHaveCount(1);
}

test("the full pursuit page moves an applied role to Rejected, and it stays Rejected", { tag: ["@J-TRACKER-51"] }, async ({ page, diagnostics }) => {
    await seed(page, [guestPursuit("guest-journey-status", "applied")]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/yours/guest-journey-status");

    await expectPressed(page, "Applied");
    await expect(statusRow(page).getByRole("button")).toHaveText(["Saved", "Applied", "Interviewing", "Offer", "Rejected", "Withdrawn"]);
    await statusButton(page, "Rejected").click();
    await expectPressed(page, "Rejected");
    await expect(page.getByText("Marked rejected")).toBeVisible();

    await page.reload();
    await expectPressed(page, "Rejected");

    // The board files it under Closed, labelled Rejected.
    await page.goto("/yours");
    const closed = page.getByRole("region", { name: "Closed" });
    await expect(closed.getByTestId("pursuit-row")).toContainText("Manager, Solutions Engineering, MM", { timeout: 15_000 });
    await expect(closed.getByTestId("pursuit-row")).toContainText("Rejected");
    expect(diagnostics.consoleErrors.filter((e) => HYDRATION.test(e))).toEqual([]);
    expect(diagnostics.pageErrors).toEqual([]);
    expect(diagnostics.serverErrors).toEqual([]);
});

test("the full pursuit page names the role once and renders the posting's Markdown", { tag: ["@J-TRACKER-52"] }, async ({ page, diagnostics }) => {
    await seed(page, [guestPursuit("guest-journey-once", "applied")]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/yours/guest-journey-once");

    await expectPressed(page, "Applied");
    // One h1: the role. The company and location are its subline, not a second card header.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Manager, Solutions Engineering, MM"]);
    await expect(page.getByText("1password · Remote (United States | Canada)")).toBeVisible();
    await expect(page.getByText("Manager, Solutions Engineering, MM", { exact: true })).toHaveCount(1);

    const about = page.getByTestId("pursuit-description");
    await expect(about).toContainText("1Password is growing");
    await expect(about.getByRole("heading", { name: "What you'll do" })).toBeVisible();
    await expect(about.getByRole("listitem")).toHaveText(["Lead a team of solutions engineers", "Coach the team on technical discovery"]);
    await expect(about).not.toContainText("*");
    await expect(about).not.toContainText("##");
    expect(diagnostics.pageErrors).toEqual([]);
});

test("the pursuit page's status row fits a phone and sets Withdrawn", { tag: ["@J-TRACKER-53"] }, async ({ page, diagnostics }) => {
    await seed(page, [guestPursuit("guest-journey-phone", "interviewing")]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/yours/guest-journey-phone");

    await expectPressed(page, "Interviewing");
    for (const name of ["Saved", "Applied", "Interviewing", "Offer", "Rejected", "Withdrawn"]) {
        await expect(statusButton(page, name)).toBeInViewport();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

    await statusButton(page, "Withdrawn").click();
    await expectPressed(page, "Withdrawn");
    await expect(page.getByText("Marked withdrawn")).toBeVisible();
    expect(diagnostics.pageErrors).toEqual([]);
});

test("a note typed on the pursuit page saves itself and is there after a reload", { tag: ["@J-TRACKER-54"] }, async ({ page, diagnostics }) => {
    await seed(page, [guestPursuit("guest-journey-note", "applied")]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/yours/guest-journey-note");

    await expectPressed(page, "Applied");
    await page.getByLabel("Note").fill("Recruiter: Dana");
    await expect(page.getByTestId("pursuit-note-status")).toHaveText("saved", { timeout: 10_000 });
    await page.reload();
    await expect(page.getByLabel("Note")).toHaveValue("Recruiter: Dana", { timeout: 15_000 });
    expect(diagnostics.pageErrors).toEqual([]);
});

test("a note typed the moment the pursuit page loads keeps its text; the page is not rebuilt under it", { tag: ["@J-TRACKER-58"] }, async ({ page, diagnostics }) => {
    await seed(page, [guestPursuit("guest-journey-early-note", "applied")]);
    // Count each time the page's <main> leaves the document. The deferred auth
    // and analytics providers used to rebuild every page after load (see
    // J-NAV-39), which wiped a note typed in that window.
    await page.addInitScript(() => {
        const w = window as unknown as { __mainRemovals: number };
        w.__mainRemovals = 0;
        document.addEventListener("DOMContentLoaded", () => {
            new MutationObserver((records) => {
                for (const r of records) {
                    for (const n of r.removedNodes) {
                        if (n instanceof Element && (n.id === "main" || n.querySelector("#main"))) w.__mainRemovals++;
                    }
                }
            }).observe(document.documentElement, { childList: true, subtree: true });
        });
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/yours/guest-journey-early-note");

    const note = page.getByLabel("Note");
    await expect(note).toBeVisible({ timeout: 15_000 });
    await note.fill("Typed right after load");
    // Past load and idle, when the deferred providers mount.
    await page.waitForLoadState("load");
    await page.waitForTimeout(3_000);

    await expect(note).toHaveValue("Typed right after load");
    await expect(page.getByTestId("pursuit-note-status")).toHaveText("saved");
    expect(await page.evaluate(() => (window as unknown as { __mainRemovals: number }).__mainRemovals)).toBe(0);
    expect(diagnostics.pageErrors).toEqual([]);
});

test("Remove on the pursuit page asks first; Cancel keeps the role, Remove returns to the board without it", { tag: ["@J-TRACKER-55"] }, async ({ page, diagnostics }) => {
    await seed(page, [guestPursuit("guest-journey-remove", "applied")]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/yours/guest-journey-remove");

    await expectPressed(page, "Applied");
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(page.getByText("Remove Manager, Solutions Engineering, MM at 1password?")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("Remove Manager, Solutions Engineering, MM at 1password?")).toHaveCount(0);

    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await page.getByRole("button", { name: "Remove", exact: true }).last().click();
    await expect(page).toHaveURL("/yours", { timeout: 15_000 });
    await expect(page.getByTestId("pursuit-row")).toHaveCount(0);
    expect(diagnostics.pageErrors).toEqual([]);
});

test("a deep link to a tracked role loads it without a not-found flash or a hydration error", { tag: ["@J-TRACKER-31"] }, async ({ page, diagnostics }) => {
    await seed(page, [guestPursuit("guest-journey-deep", "applied")]);
    await page.setViewportSize({ width: 1440, height: 900 });
    // The server can't see a browser's pursuits; it must render the loading
    // state, never "We couldn't find that pursuit".
    const html = await (await page.request.get("/yours/guest-journey-deep")).text();
    expect(html).not.toContain("couldn&#x27;t find that pursuit");
    expect(html).not.toContain("couldn't find that pursuit");

    await page.goto("/yours/guest-journey-deep");
    await expectPressed(page, "Applied");
    await page.reload();
    await expectPressed(page, "Applied");
    expect(diagnostics.consoleErrors.filter((e) => HYDRATION.test(e))).toEqual([]);
    expect(diagnostics.pageErrors).toEqual([]);
});

test("Applied on a saved role's page stamps the day and offers the interview date", { tag: ["@J-TRACKER-33"] }, async ({ page, diagnostics }) => {
    await seed(page, [guestPursuit("guest-journey-saved", "interested")]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/yours/guest-journey-saved");

    await expectPressed(page, "Saved");
    await expect(page.getByTestId("pursuit-dates")).toContainText("Saved");
    await expect(page.getByLabel("Interview date")).toHaveCount(0);
    await statusButton(page, "Applied").click();
    await expectPressed(page, "Applied");
    await expect(page.getByTestId("pursuit-dates")).toContainText("Applied");
    await expect(page.getByLabel("Interview date")).toBeVisible();
    expect(diagnostics.pageErrors).toEqual([]);
});

test("setting an interview date on the page moves the role to Interviewing on that day", { tag: ["@J-TRACKER-34"] }, async ({ page, diagnostics }) => {
    await seed(page, [guestPursuit("guest-journey-interview", "applied")]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/yours/guest-journey-interview");

    await expectPressed(page, "Applied");
    await page.getByLabel("Interview date").fill("2026-11-03");
    await page.getByRole("button", { name: "Set interview date" }).click();
    await expectPressed(page, "Interviewing");
    await expect(page.getByText("Interview date saved")).toBeVisible();
    await expect(page.getByTestId("pursuit-dates")).toContainText("Interview Nov 3");
    await expect(page.getByLabel("Interview date")).toHaveValue("2026-11-03");
    await expect(page.getByRole("button", { name: "Change date" })).toBeDisabled();
    expect(diagnostics.pageErrors).toEqual([]);
});

test.describe("west of UTC", () => {
    test.use({ timezoneId: "America/Vancouver" });

    test("the pursuit page shows the interview on the day it was set", { tag: ["@J-TRACKER-56"] }, async ({ page, diagnostics }) => {
        // Stored as UTC midnight; read in Vancouver's zone it showed as Nov 2.
        await seed(page, [guestPursuit("guest-journey-tz", "interviewing", { interview_date: "2026-11-03T00:00:00.000Z" })]);
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto("/yours/guest-journey-tz");
        await expectPressed(page, "Interviewing");
        await expect(page.getByTestId("pursuit-dates")).toContainText("Interview Nov 3");
        await expect(page.getByLabel("Interview date")).toHaveValue("2026-11-03");
        expect(diagnostics.pageErrors).toEqual([]);
    });
});

test("the tracker board with guest roles loads without an empty-state flash or a hydration error", { tag: ["@J-TRACKER-57"] }, async ({ page, diagnostics }) => {
    await seed(page, [guestPursuit("guest-journey-board", "applied")]);
    await page.setViewportSize({ width: 1440, height: 900 });
    // The server can't see a browser's roles: it renders the loading skeleton, not "nothing tracked".
    const html = await (await page.request.get("/yours")).text();
    expect(html).not.toContain('data-testid="yours-guest-empty"');

    await page.goto("/yours");
    await expect(page.getByRole("region", { name: "Applied" }).getByTestId("pursuit-row")).toContainText("Manager, Solutions Engineering, MM", {
        timeout: 15_000,
    });
    await expect(page.getByTestId("tracker-export-csv")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("pursuit-row")).toHaveCount(1, { timeout: 15_000 });
    expect(diagnostics.consoleErrors.filter((e) => HYDRATION.test(e))).toEqual([]);
    expect(diagnostics.pageErrors).toEqual([]);
});

test.describe("detail sheet below xl", () => {
    test("the sheet's status row marks Rejected with a toast", { tag: ["@J-TRACKER-21"] }, async ({ page, diagnostics }) => {
        await seed(page, [guestPursuit("guest-journey-sheet", "applied")]);
        await page.setViewportSize({ width: 1024, height: 768 });
        await page.goto("/yours");

        await page.getByTestId("pursuit-row").first().click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible({ timeout: 10_000 });
        const rejected = dialog.getByRole("group", { name: "Status" }).getByRole("button", { name: "Rejected", exact: true });
        await rejected.click();
        await expect(rejected).toHaveAttribute("aria-pressed", "true");
        await expect(page.getByText("Marked rejected")).toBeVisible();
        expect(diagnostics.pageErrors).toEqual([]);
    });

    test("Rejected and Withdrawn in the sheet each move the row to the Closed lane", { tag: ["@J-TRACKER-22"] }, async ({ page, diagnostics }) => {
        await seed(page, [guestPursuit("guest-journey-lane-a", "applied"), guestPursuit("guest-journey-lane-b", "offer", { position: "Staff Engineer" })]);
        await page.setViewportSize({ width: 1024, height: 768 });
        await page.goto("/yours");

        const closed = page.getByRole("region", { name: "Closed" });
        for (const [role, status] of [
            ["Manager, Solutions Engineering, MM", "Rejected"],
            ["Staff Engineer", "Withdrawn"],
        ] as const) {
            await page.getByTestId("pursuit-row").filter({ hasText: role }).click();
            const dialog = page.getByRole("dialog");
            await expect(dialog).toBeVisible({ timeout: 10_000 });
            const button = dialog.getByRole("group", { name: "Status" }).getByRole("button", { name: status, exact: true });
            await button.click();
            await expect(button).toHaveAttribute("aria-pressed", "true");
            await page.keyboard.press("Escape");
            await expect(dialog).toBeHidden();
            // Read the board once the modal is closed; it hides the page from the accessibility tree.
            await expect(closed.getByTestId("pursuit-row").filter({ hasText: role })).toContainText(status);
        }
        await expect(closed.getByTestId("pursuit-row")).toHaveCount(2);
        expect(diagnostics.pageErrors).toEqual([]);
    });
});

test("a note typed in the sheet keeps focus through each autosave and is all there after reopening", { tag: ["@J-TRACKER-24"] }, async ({ page, diagnostics }) => {
    await seed(page, [guestPursuit("guest-journey-sheet-note", "applied")]);
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/yours");

    await page.getByTestId("pursuit-row").first().click();
    const dialog = page.getByRole("dialog");
    const note = dialog.getByLabel("Note");
    await note.click();
    await page.keyboard.type("Recruiter");
    await expect(dialog.getByTestId("pursuit-note-status")).toHaveText("saved", { timeout: 10_000 });
    // Each autosave used to remount the sheet body, so focus left and the rest of the typing was lost.
    await expect(note).toBeFocused();
    await page.keyboard.type(" Dana");
    await expect(note).toHaveValue("Recruiter Dana");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await page.getByTestId("pursuit-row").first().click();
    await expect(page.getByRole("dialog").getByLabel("Note")).toHaveValue("Recruiter Dana");
    expect(diagnostics.pageErrors).toEqual([]);
});

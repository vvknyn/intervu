import type { Download, Locator, Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { extractText } from "unpdf";
import { authGateCopy } from "../../../src/lib/auth/auth-gate-copy";
import { LOCAL_AI_RESUME_KEY } from "../../../src/lib/local-ai/resume-storage";
import { expect, test } from "./fixtures";
import { actionObject, PRODUCTION_SIGN_IN_ACCOUNT, signInLikeProduction } from "./signed-in";

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

/** A guest's résumé on this device (`velai.localAi.resume`), as the importer stores it. */
const DEVICE_RESUME = {
    profile: { name: "Ada Lovelace", profession: "Solutions Engineer", yearsOfExperience: 8, location: "Toronto, ON", email: "ada@example.com", phone: "(555) 010-2345" },
    experience: [
        {
            id: "exp-1",
            company: "Analytical Engines",
            role: "Solutions Engineer",
            dates: "Jan 2020 - Present",
            description: "• Led technical discovery for 40 enterprise accounts\n• Built the demo every deal used",
        },
    ],
    projects: [],
    competencies: [{ category: "", skills: ["Technical discovery", "APIs", "SQL"] }],
    education: [{ id: "edu-1", degree: "BSc Mathematics", institution: "University of London", year: "2015" }],
    generatedSummary: "Solutions engineer who turns product depth into customer wins.",
};

async function seedDeviceResume(page: Page) {
    await page.addInitScript(
        ([key, data]) => {
            if (sessionStorage.getItem("journey-resume-seeded")) return;
            localStorage.setItem(key as string, JSON.stringify({ data, updatedAt: "2026-10-01T12:00:00.000Z" }));
            sessionStorage.setItem("journey-resume-seeded", "1");
        },
        [LOCAL_AI_RESUME_KEY, DEVICE_RESUME] as const,
    );
}

/** The downloaded PDF's text. */
async function pdfText(download: Download) {
    expect(download.suggestedFilename()).toMatch(/\.pdf$/);
    const { text } = await extractText(new Uint8Array(readFileSync((await download.path())!)), { mergePages: true });
    return text;
}

/** The status dropdown. It was a row of six tabs, which read as navigation (founder 2026-10-05: "it should be a dropdown"). */
const statusPicker = (scope: Page | Locator) => scope.getByRole("combobox", { name: "Status" });
const STATUS_OPTIONS = ["Saved", "Applied", "Interviewing", "Offer", "Rejected", "Withdrawn"];

/** Opens the dropdown and picks `name`; its options are portaled to the page, above any sheet. */
async function pickStatus(page: Page, name: string, scope: Page | Locator = page) {
    await statusPicker(scope).click();
    await page.getByRole("option", { name, exact: true }).click();
}

async function expectStatus(scope: Page | Locator, name: string) {
    await expect(statusPicker(scope)).toHaveText(name, { timeout: 15_000 });
}

test("the full pursuit page moves an applied role to Rejected, and it stays Rejected", { tag: ["@J-TRACKER-51"] }, async ({ page, diagnostics }) => {
    await seed(page, [guestPursuit("guest-journey-status", "applied")]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/yours/guest-journey-status");

    await expectStatus(page, "Applied");
    await statusPicker(page).click();
    await expect(page.getByRole("option")).toHaveText(STATUS_OPTIONS);
    await page.getByRole("option", { name: "Rejected", exact: true }).click();
    await expectStatus(page, "Rejected");
    await expect(page.getByText("Marked rejected")).toBeVisible();

    await page.reload();
    await expectStatus(page, "Rejected");

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

    await expectStatus(page, "Applied");
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

test("the pursuit page's status dropdown fits a phone and sets Withdrawn", { tag: ["@J-TRACKER-53"] }, async ({ page, diagnostics }) => {
    await seed(page, [guestPursuit("guest-journey-phone", "interviewing")]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/yours/guest-journey-phone");

    await expectStatus(page, "Interviewing");
    await expect(statusPicker(page)).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await statusPicker(page).click();
    for (const name of STATUS_OPTIONS) {
        await expect(page.getByRole("option", { name, exact: true })).toBeInViewport();
    }
    await page.getByRole("option", { name: "Withdrawn", exact: true }).click();
    await expectStatus(page, "Withdrawn");
    await expect(page.getByText("Marked withdrawn")).toBeVisible();
    expect(diagnostics.pageErrors).toEqual([]);
});

test("a note typed on the pursuit page saves itself and is there after a reload", { tag: ["@J-TRACKER-54"] }, async ({ page, diagnostics }) => {
    await seed(page, [guestPursuit("guest-journey-note", "applied")]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/yours/guest-journey-note");

    await expectStatus(page, "Applied");
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

    await expectStatus(page, "Applied");
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
    await expectStatus(page, "Applied");
    await page.reload();
    await expectStatus(page, "Applied");
    expect(diagnostics.consoleErrors.filter((e) => HYDRATION.test(e))).toEqual([]);
    expect(diagnostics.pageErrors).toEqual([]);
});

test("Applied on a saved role's page stamps the day and offers the interview date", { tag: ["@J-TRACKER-33"] }, async ({ page, diagnostics }) => {
    await seed(page, [guestPursuit("guest-journey-saved", "interested")]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/yours/guest-journey-saved");

    await expectStatus(page, "Saved");
    await expect(page.getByTestId("pursuit-dates")).toContainText("Saved");
    await expect(page.getByLabel("Interview date")).toHaveCount(0);
    await pickStatus(page, "Applied");
    await expectStatus(page, "Applied");
    await expect(page.getByTestId("pursuit-dates")).toContainText("Applied");
    await expect(page.getByLabel("Interview date")).toBeVisible();
    // A visible label, not only an accessible name: the field was a bare date box (journey audit).
    await expect(page.getByText("Interview date", { exact: true })).toBeVisible();
    expect(diagnostics.pageErrors).toEqual([]);
});

test("setting an interview date on the page moves the role to Interviewing on that day", { tag: ["@J-TRACKER-34"] }, async ({ page, diagnostics }) => {
    await seed(page, [guestPursuit("guest-journey-interview", "applied")]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/yours/guest-journey-interview");

    await expectStatus(page, "Applied");
    await page.getByLabel("Interview date").fill("2026-11-03");
    await page.getByRole("button", { name: "Set interview date" }).click();
    await expectStatus(page, "Interviewing");
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
        await expectStatus(page, "Interviewing");
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
        await pickStatus(page, "Rejected", dialog);
        await expectStatus(dialog, "Rejected");
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
            await pickStatus(page, status, dialog);
            await expectStatus(dialog, status);
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

test.describe("signed-in header", () => {
    // The header's tabs, and the Tracker count on them, only render for a
    // signed-in user, and the only sign-in a spec can fake is the dev-only
    // `window.__INTERVU_E2E_AUTH__` hook a production build ignores (same as
    // header-tabs.spec.ts). So this runs against a local dev server only.
    test.beforeEach(({ baseURL }) => {
        const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseURL ?? "http://localhost:3000");
        test.skip(!local, "signed-in header needs the dev-only __INTERVU_E2E_AUTH__ hook, which production builds ignore");
    });
    test.afterEach(({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));

    test("the Tracker heading counts open roles only, not rejected or withdrawn ones", { tag: ["@J-TRACKER-59"] }, async ({ page }) => {
        const now = new Date().toISOString();
        const statuses: Status[] = ["applied", "interviewing", "rejected", "withdrawn", "rejected"];
        // Every argument-less action here answers "User not authenticated"
        // (the tracker list and the header's follows alike), and a spec can't
        // tell them apart, so each row also carries a follow's fields.
        const rows = statuses.map((status, i) => ({
            id: `app-${i}`,
            user_id: "u1",
            company_name: `Company ${i}`,
            position: `Role ${i}`,
            status,
            created_at: now,
            updated_at: now,
            domain: `company${i}.example`,
            slug: `company-${i}`,
            displayName: `Company ${i}`,
            createdAt: now,
        }));
        await page.addInitScript(() => {
            (window as unknown as Record<string, unknown>).__INTERVU_E2E_AUTH__ = {
                uid: "u1", displayName: "Ada Lovelace", email: "ada@example.com", emailVerified: true, isAnonymous: false,
                providerData: [], metadata: {}, photoURL: null, phoneNumber: null, providerId: "password", tenantId: null, refreshToken: "x",
            };
        });
        await page.route(
            () => true,
            async (route) => {
                const req = route.request();
                if (req.method() !== "POST" || !req.headers()["next-action"]) return route.continue();
                const res = await route.fetch();
                const text = await res.text();
                if ((req.postData() ?? "") !== "[]" || !text.includes("User not authenticated")) return route.fulfill({ response: res, body: text });
                // Next server-action response in flight format: `1:` carries the return value.
                const body = `0:{"a":"$@1","f":"","q":"","i":true,"b":"development"}\n1:D"$2"\n1:${JSON.stringify({ data: rows })}\n`;
                return route.fulfill({ response: res, body });
            },
        );
        // The count rides on the Tracker page heading (it left the nav tab).
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto("/yours");

        // It used to count every tracked role (5 here), closed ones too. No
        // page-error check: the faked sign-in exists only on the client, so the
        // header always mismatches the server's signed-out HTML here.
        await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tracker · 2 jobs", { timeout: 30_000 });
        await expect(page.getByTestId("topbar-tracker-badge")).toHaveCount(0);
    });
});

test("a role with no résumé filed shows no empty résumé card or dead Download; one with a filed résumé lists it", { tag: ["@J-TRACKER-60"] }, async ({ page, diagnostics }) => {
    const filed = { content: "# Ada Lovelace\n\n## Experience", label: "Tailored for 1Password", saved_at: "2026-09-28T12:00:00.000Z" };
    await seed(page, [
        guestPursuit("guest-journey-resume-none", "applied"),
        guestPursuit("guest-journey-resume-filed", "applied", { position: "Staff Engineer", resume_versions: [filed] }),
    ]);
    await page.setViewportSize({ width: 1440, height: 900 });

    // Only the MCP tools file a résumé against a role, so a web user's page
    // used to end in "No resume version on file" on every role.
    await page.goto("/yours/guest-journey-resume-none");
    await expectStatus(page, "Applied");
    await expect(page.getByText("Resume used")).toHaveCount(0);
    await expect(page.getByText(/No resume version on file/)).toHaveCount(0);

    await page.goto("/yours/guest-journey-resume-filed");
    await expectStatus(page, "Applied");
    await expect(page.getByText("Resume used")).toBeVisible();
    await expect(page.getByText("Tailored for 1Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Download", exact: true })).toBeVisible();

    // The sheet below xl: no "none linked" and no disabled Download resume.
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/yours");
    await page.getByTestId("pursuit-row").filter({ hasText: "Manager, Solutions Engineering, MM" }).click();
    let dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByRole("button", { name: "Download resume" })).toHaveCount(0);
    await expect(dialog.getByText(/none linked|No resume version on file/)).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await page.getByTestId("pursuit-row").filter({ hasText: "Staff Engineer" }).click();
    dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Download resume" })).toBeEnabled({ timeout: 10_000 });
    await expect(dialog.getByText("Tailored for 1Password")).toBeVisible();
    expect(diagnostics.pageErrors).toEqual([]);
});

test("a résumé the person's agent filed in markdown downloads as a formatted PDF, not with its # and ** marks", { tag: ["@J-TRACKER-73"] }, async ({ page, diagnostics }) => {
    // The shape an agent files through the MCP tools (and resumeDataToZipMarkdown writes).
    const content = [
        "# Ada Lovelace",
        "London, UK | ada@example.com | [LinkedIn](https://linkedin.com/in/ada-lovelace)",
        "",
        "## Professional Summary",
        "",
        "Analyst of **computing engines** and their programs.",
        "",
        "## Core Competencies",
        "",
        "**Mathematics:** Analysis, Bernoulli numbers",
        "",
        "## Professional Experience",
        "",
        "### Analyst | Analytical Engines",
        "Jan 1842 - Present",
        "",
        "- Wrote the first published program for the *Analytical Engine*",
        "",
        "### Translator | Scientific Memoirs",
        "Jan 1840 - Dec 1842",
        "",
        "- Translated and annotated Menabrea's paper",
    ].join("\n");
    const filed = { content, label: "Tailored for 1Password", saved_at: "2026-10-03T12:00:00.000Z" };
    await seed(page, [guestPursuit("guest-journey-resume-markdown", "applied", { position: "Staff Engineer", resume_versions: [filed] })]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/yours/guest-journey-resume-markdown");
    await expect(page.getByText("Resume used")).toBeVisible({ timeout: 15_000 });

    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download", exact: true }).click()]);
    const text = (await pdfText(download)).replace(/\s+/g, " ");
    // It printed "# Ada Lovelace", "## Professional Summary" and "**Mathematics:**".
    expect(text).toContain("Ada Lovelace");
    expect(text).toContain("Professional Summary");
    expect(text).toContain("Analyst of computing engines and their programs.");
    expect(text).toContain("Mathematics: Analysis, Bernoulli numbers");
    expect(text).toContain("linkedin.com/in/ada-lovelace");
    expect(text).not.toMatch(/#|\*\*|\]\(/);
    // The second role's header is its own entry, not the end of the first role's bullet.
    expect(text).not.toMatch(/Analytical Engine Translator/);
    expect(diagnostics.pageErrors).toEqual([]);
});

test("a guest's Open posting on a tracked role's page asks to sign in to apply, and opens no employer tab", { tag: ["@J-TRACKER-61"] }, async ({ page, diagnostics }) => {
    // A role tracked by hand: a posting link but no Velai job, so the page offers Open posting.
    await seed(page, [guestPursuit("guest-journey-open-posting", "applied", { job_id: null, job_snapshot: null })]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/yours/guest-journey-open-posting");
    await expectStatus(page, "Applied");

    let popups = 0;
    page.on("popup", () => popups++);
    await page.getByRole("button", { name: "Open posting" }).click();
    // It used to open a plain "Sign in": the page never passed the gate's reason to its dialog.
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(authGateCopy("apply").title, { exact: true }).and(page.locator(":visible")).first()).toBeVisible({ timeout: 10_000 });
    expect(popups, "no employer tab opens before sign-in").toBe(0);
    expect(diagnostics.pageErrors).toEqual([]);
});

test("marking a saved role Applied keeps the résumé on this device on it, to download or remove", { tag: ["@J-TRACKER-69"] }, async ({ page, diagnostics }) => {
    await seedDeviceResume(page);
    await seed(page, [guestPursuit("guest-journey-copy", "interested")]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/yours/guest-journey-copy");

    await expectStatus(page, "Saved");
    await expect(page.getByText("Resume used")).toHaveCount(0);
    await pickStatus(page, "Applied");
    await expectStatus(page, "Applied");

    // "Resume used" could only ever be filled by the MCP tools (journey audit 2026-09-30).
    const copy = page.getByTestId("applied-resume");
    await expect(copy).toContainText("Your résumé");
    await expect(copy).toContainText("copied when you marked it Applied");
    const [download] = await Promise.all([page.waitForEvent("download"), copy.getByRole("button", { name: "Download", exact: true }).click()]);
    const text = await pdfText(download);
    expect(text).toContain("Ada Lovelace");
    expect(text).toContain("Analytical Engines");
    expect(text).not.toContain("#");

    // It stays on the role; Remove asks first and leaves the role Applied.
    await page.reload();
    await expect(page.getByTestId("applied-resume")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Remove résumé" }).click();
    await expect(page.getByText("Remove this copy from the role? Your résumé itself stays.")).toBeVisible();
    await page.getByRole("button", { name: "Remove résumé" }).click();
    await expect(page.getByText("Résumé removed from this role")).toBeVisible();
    await expect(page.getByText("Resume used")).toHaveCount(0);
    await expectStatus(page, "Applied");
    await page.reload();
    await expectStatus(page, "Applied");
    await expect(page.getByText("Resume used")).toHaveCount(0);
    expect(diagnostics.pageErrors).toEqual([]);
});

test.describe("signed in the way production signs in", () => {
    // The tracker's writes branched on `getCurrentUser()`, which only the
    // dev-only sign-in hook answers; see `signInLikeProduction`.
    function accountPursuit(id: string, status: Status) {
        const now = new Date().toISOString();
        return {
            ...guestPursuit(id, status),
            user_id: PRODUCTION_SIGN_IN_ACCOUNT.uid,
            // Every argument-less action answers the same way signed out (the
            // header's follows too), so each row also carries a follow's fields.
            domain: "1password.com",
            slug: "1password",
            displayName: "1password",
            createdAt: now,
        };
    }

    /**
     * Serves the account's pursuits: an argument-less action gets the list,
     * and an update or delete naming a row is applied to it and recorded.
     */
    async function signInWithAccount(page: Page, rows: ReturnType<typeof accountPursuit>[]) {
        const writes: { id: string; patch?: Record<string, unknown> }[] = [];
        await signInLikeProduction(page, (args) => {
            if (args.length === 0) return { data: rows };
            const row = rows.find((r) => r.id === args[0]);
            if (!row) return undefined;
            if (args.length === 2) {
                const patch = actionObject(args[1]);
                Object.assign(row, patch);
                writes.push({ id: row.id, patch });
            } else {
                rows.splice(rows.indexOf(row), 1);
                writes.push({ id: row.id });
            }
            return { success: true };
        });
        return writes;
    }

    /** Records whether `selector` was ever in the page, for a flash that's gone before an assertion could look. */
    async function watchFor(page: Page, selector: string) {
        await page.addInitScript((sel) => {
            new MutationObserver(() => {
                if (document.querySelector(sel)) (window as unknown as Record<string, boolean>).__journeyFlashed = true;
            }).observe(document, { childList: true, subtree: true });
        }, selector);
    }
    const flashed = (page: Page) => page.evaluate(() => (window as unknown as Record<string, boolean>).__journeyFlashed === true);

    test.afterEach(({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));

    test("the pursuit page saves a status change to the account, with no not-found flash while the session check runs", { tag: ["@J-TRACKER-67"] }, async ({ page, diagnostics }) => {
        const writes = await signInWithAccount(page, [accountPursuit("app-journey-status", "applied")]);
        await watchFor(page, '[data-testid="pursuit-not-found"]');
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto("/yours/app-journey-status");

        await expectStatus(page, "Applied");
        await pickStatus(page, "Rejected");
        await expect(page.getByText("Marked rejected")).toBeVisible();
        await expectStatus(page, "Rejected");
        await expect(page.getByText("Could not find this pursuit.")).toHaveCount(0);
        expect(writes).toEqual([{ id: "app-journey-status", patch: expect.objectContaining({ status: "rejected" }) }]);

        // The account's copy is what a reload reads back.
        await page.reload();
        await expectStatus(page, "Rejected");
        expect(await flashed(page)).toBe(false);
        expect(diagnostics.pageErrors).toEqual([]);
    });

    test("the board's sheet saves a status change and a removal to the account, with no empty-board flash while the session check runs", { tag: ["@J-TRACKER-68"] }, async ({ page, diagnostics }) => {
        const writes = await signInWithAccount(page, [accountPursuit("app-journey-sheet", "applied")]);
        await watchFor(page, '[data-testid="yours-empty"], [data-testid="yours-guest-empty"]');
        await page.setViewportSize({ width: 1024, height: 768 });
        await page.goto("/yours");

        await page.getByTestId("pursuit-row").first().click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible({ timeout: 10_000 });
        await pickStatus(page, "Rejected", dialog);
        await expect(page.getByText("Marked rejected")).toBeVisible();
        await expectStatus(dialog, "Rejected");
        expect(writes).toEqual([{ id: "app-journey-sheet", patch: expect.objectContaining({ status: "rejected" }) }]);
        expect(await flashed(page)).toBe(false);

        // Remove used to say "Removed" and leave the account's role in place.
        await dialog.getByRole("button", { name: "Remove", exact: true }).click();
        await dialog.getByRole("button", { name: "Remove", exact: true }).last().click();
        await expect(dialog).toBeHidden();
        await expect(page.getByTestId("pursuit-row")).toHaveCount(0);
        expect(writes).toEqual([{ id: "app-journey-sheet", patch: expect.objectContaining({ status: "rejected" }) }, { id: "app-journey-sheet" }]);
        await expect(page.getByText("Could not find this pursuit.")).toHaveCount(0);
        expect(diagnostics.pageErrors).toEqual([]);
    });

    // The account's list sends a role's résumé copy without its text; Download reads it.
    const COPIED_AT = "2026-10-03T15:00:00.000Z";
    const ACCOUNT_RESUME_TEXT = [
        "Ada Lovelace",
        "Toronto, ON | ada@example.com | (555) 010-2345",
        "",
        "EXPERIENCE",
        "Solutions Engineer | Analytical Engines Jan 2020 - Present",
        "• Led technical discovery for 40 enterprise accounts",
    ].join("\n");

    test("marking a role Applied in the board's sheet shows the résumé the account copied on, which downloads and comes off", { tag: ["@J-TRACKER-71"] }, async ({ page, diagnostics }) => {
        const row: Record<string, unknown> = accountPursuit("app-journey-copy", "interested");
        const calls: unknown[][] = [];
        // Download and Remove each send just the role's id; the test says which is next.
        let answerById: () => unknown = () => undefined;
        await signInLikeProduction(page, (args) => {
            if (args.length === 0) return { data: [row] };
            if (args[0] !== row.id) return undefined;
            calls.push(args);
            if (args.length === 2) {
                const patch = actionObject(args[1]);
                Object.assign(row, patch);
                // What the server does on the move into Applied: copy the résumé on file.
                if (patch.status === "applied") row.applied_resume = { saved_at: COPIED_AT };
                return { data: row };
            }
            return answerById();
        });
        await page.setViewportSize({ width: 1024, height: 768 });
        await page.goto("/yours");

        await page.getByTestId("pursuit-row").first().click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible({ timeout: 10_000 });
        await expect(dialog.getByRole("button", { name: "Download resume" })).toHaveCount(0);
        await pickStatus(page, "Applied", dialog);
        await expect(page.getByText("Marked applied")).toBeVisible();
        await expect(dialog.getByText("Your résumé")).toBeVisible({ timeout: 10_000 });

        answerById = () => ({ data: { saved_at: COPIED_AT, content: ACCOUNT_RESUME_TEXT } });
        const [download] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: "Download resume" }).click()]);
        expect(await pdfText(download)).toContain("Analytical Engines");

        answerById = () => {
            delete row.applied_resume;
            return {};
        };
        await dialog.getByRole("button", { name: "Remove résumé" }).click();
        await dialog.getByRole("button", { name: "Remove résumé" }).click();
        await expect(page.getByText("Résumé removed from this role")).toBeVisible();
        await expect(dialog.getByText("Your résumé")).toHaveCount(0);
        await expect(dialog.getByRole("button", { name: "Download resume" })).toHaveCount(0);
        expect(calls).toEqual([
            [row.id, expect.objectContaining({ status: "applied" })],
            [row.id],
            [row.id],
        ]);
        expect(diagnostics.pageErrors).toEqual([]);
    });

    test("signing in carries a guest role's résumé copy onto the account's role, dated when it was taken", { tag: ["@J-TRACKER-72"] }, async ({ page, diagnostics }) => {
        await seed(page, [guestPursuit("guest-journey-carry", "applied", { applied_resume: { saved_at: COPIED_AT, content: ACCOUNT_RESUME_TEXT } })]);
        const rows: Record<string, unknown>[] = [];
        const kept: unknown[] = [];
        await signInLikeProduction(page, (args) => {
            if (args.length === 0) return { data: rows };
            const [first, second] = args;
            // upsertPursuitForJob(job, stage): the guest role lands on the account.
            if (first && typeof first === "object" && "job_id" in first && typeof second === "string") {
                const created = accountPursuit("app-journey-carry", second as Status);
                rows.push(created);
                return { data: created };
            }
            // Then its copy follows it.
            if (first === "app-journey-carry" && second && typeof second === "object") {
                kept.push(actionObject(second));
                return {};
            }
            return undefined;
        });
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto("/yours");

        await expect(page.getByText("Synced 1 guest role")).toBeVisible({ timeout: 15_000 });
        expect(kept).toEqual([{ saved_at: COPIED_AT, content: ACCOUNT_RESUME_TEXT }]);
        expect(await page.evaluate((key) => localStorage.getItem(key), GUEST_PURSUITS_KEY)).toBe("[]");
        expect(diagnostics.pageErrors).toEqual([]);
    });
});

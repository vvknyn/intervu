import { expect, test } from "./fixtures";

/**
 * The page under the header must not remount after load — see
 * tests/journeys/CATALOG.md (J-NAV-39). The deferred AuthKit and PostHog
 * providers used to wrap the whole app once they were ready, which swapped the
 * element above every page: React remounted it a moment after load and page
 * state, focus and anything already typed were lost (2026-09-30, a note typed
 * on /yours/[id] vanished). They now mount beside the app.
 */

test("the page under the header is not remounted after load, so what you type right away stays", { tag: ["@J-NAV-39"] }, async ({ page, diagnostics }) => {
    const now = new Date().toISOString();
    await page.addInitScript((row) => {
        if (!sessionStorage.getItem("journey-seeded")) {
            localStorage.setItem("intervu.pursuits.guest", JSON.stringify([row]));
            sessionStorage.setItem("journey-seeded", "1");
        }
        // Count every time the app's <main> is taken out of the document.
        (window as unknown as { __mainRemovals: number }).__mainRemovals = 0;
        document.addEventListener("DOMContentLoaded", () => {
            new MutationObserver((records) => {
                for (const r of records) {
                    for (const n of r.removedNodes) {
                        if (n instanceof Element && (n.id === "main" || n.querySelector("#main"))) {
                            (window as unknown as { __mainRemovals: number }).__mainRemovals++;
                        }
                    }
                }
            }).observe(document.documentElement, { childList: true, subtree: true });
        });
    }, {
        id: "guest-journey-shell",
        user_id: "guest",
        company_name: "Acme Corp",
        position: "Staff Engineer",
        status: "applied",
        applied_at: now,
        job_id: null,
        job_snapshot: null,
        created_at: now,
        updated_at: now,
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/yours/guest-journey-shell");

    const note = page.getByLabel("Note");
    await expect(note).toBeVisible({ timeout: 15_000 });
    await note.fill("Typed right after load");
    // Past load and idle, when the deferred providers mount (the old remount landed within a second).
    await page.waitForLoadState("load");
    await page.waitForTimeout(3_000);

    await expect(note).toHaveValue("Typed right after load");
    await expect(page.getByTestId("pursuit-note-status")).toHaveText("saved");
    expect(await page.evaluate(() => (window as unknown as { __mainRemovals: number }).__mainRemovals)).toBe(0);
    expect(diagnostics.pageErrors).toEqual([]);
});

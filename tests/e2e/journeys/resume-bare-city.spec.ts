import type { Page } from "@playwright/test";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { expect, test } from "./fixtures";

/**
 * J-RESUME-29 — a résumé whose contact line names a bare city ("Mississauga")
 * gets a one-tap question instead of a silent blank or a guess. For you needs
 * an account, so a guest is asked above the Search board their résumé ranks.
 * Read-only: the résumé is parsed in the browser and the answer is saved to
 * this browser only (guest).
 */

// Guest résumé path: src/lib/local-ai/resume-storage.ts.
const LOCAL_AI_ENABLED_KEY = "velai.localAi.enabled";
const LOCAL_AI_RESUME_KEY = "velai.localAi.resume";

/** Fabricated candidate (no real person). */
const BARE_CITY_RESUME = [
    "Maya Chen",
    "Senior Product Designer",
    "maya.chen.e2e@example.com | Mississauga | 905-555-0142",
    "",
    "EXPERIENCE",
    "Senior Product Designer, Lakeshore Health",
    "2020 - Present",
    "- Led the redesign of the patient booking flow.",
    "",
    "Product Designer, Harbourfront Bank",
    "2016 - 2020",
    "- Designed the mobile onboarding flow.",
    "",
    "EDUCATION",
    "B.Des. Interaction Design, OCAD University, 2016",
    "",
    "SKILLS",
    "Figma, Prototyping, Design Systems, User Research",
].join("\n");

const returningVisitor = (page: Page) => page.addInitScript((key) => localStorage.setItem(key, "1"), ONBOARDING_COMPLETED_STORAGE_KEY);

const storedProfile = (page: Page) =>
    page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null")?.data?.profile, LOCAL_AI_RESUME_KEY);

test("a bare city on the contact line is asked about above the ranked board; Yes saves the place", { tag: ["@J-RESUME-29"] }, async ({ page, diagnostics }) => {
    await page.goto("/jobs");
    await page.getByRole("button", { name: "Upload résumé" }).first().click({ timeout: 60_000 });
    const dialog = page.getByRole("dialog");
    await dialog.locator('input[type="file"]').setInputFiles({ name: "maya.txt", mimeType: "text/plain", buffer: Buffer.from(BARE_CITY_RESUME) });
    await dialog.getByTestId("resume-import-parse-primary").click();
    // No guess: the review leaves the location blank.
    await expect(dialog.getByLabel("Location", { exact: true })).toHaveValue("", { timeout: 30_000 });
    await dialog.getByRole("button", { name: "Rank my jobs" }).click();
    await expect(page).toHaveURL(/[?&]sort=fit/);

    const prompt = page.getByTestId("resume-place-confirm");
    await expect(prompt).toContainText("Your résumé says “Mississauga”. Is that Mississauga, Ontario, Canada?", { timeout: 30_000 });
    await prompt.getByRole("button", { name: "Yes" }).click();
    await expect(prompt).toHaveCount(0);
    const profile = await storedProfile(page);
    expect(profile.location).toBe("Mississauga, Ontario, Canada");
    expect(profile).not.toHaveProperty("unconfirmedPlaces");
    // The answer re-ranks the board there.
    await expect(page).toHaveURL(/[?&]country=Canada/);
    expect(diagnostics.pageErrors).toEqual([]);
});

test("an ambiguous bare city offers every candidate; None of these leaves the location blank", { tag: ["@J-RESUME-29"] }, async ({ page, diagnostics }) => {
    await returningVisitor(page);
    await page.addInitScript(
        ([enabledKey, resumeKey]) => {
            if (localStorage.getItem(resumeKey)) return; // seed once; the reload below must see the saved answer
            const resume = {
                profile: { name: "Sam Rivera", profession: "Software Engineer", yearsOfExperience: 4, location: "", email: "sam.rivera.dev@example.com", phone: "", unconfirmedPlaces: ["London"] },
                experience: [{ id: "exp1", company: "Nimbus Data", role: "Software Engineer", dates: "2021 - Present", description: "Built backend services." }],
                competencies: [{ category: "Languages", skills: ["TypeScript", "Python"] }],
                education: [],
                generatedSummary: "Software engineer.",
            };
            localStorage.setItem(enabledKey, "1");
            localStorage.setItem(resumeKey, JSON.stringify({ data: resume, updatedAt: new Date().toISOString(), sourceLabel: "e2e-journey-synthetic" }));
        },
        [LOCAL_AI_ENABLED_KEY, LOCAL_AI_RESUME_KEY],
    );
    await page.goto("/jobs?sort=fit");

    const prompt = page.getByTestId("resume-place-confirm");
    await expect(prompt).toContainText("Which place is it?", { timeout: 30_000 });
    for (const place of ["London, England, United Kingdom", "London, Ontario, Canada"]) {
        await expect(prompt.getByRole("button", { name: place })).toBeVisible();
    }
    await prompt.getByRole("button", { name: "None of these" }).click();
    await expect(prompt).toHaveCount(0);
    const profile = await storedProfile(page);
    expect(profile.location).toBe("");
    expect(profile).not.toHaveProperty("unconfirmedPlaces");

    // Settled: asked once, not on every visit.
    await page.reload();
    await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 30_000 });
    await expect(prompt).toHaveCount(0);
    expect(diagnostics.pageErrors).toEqual([]);
});

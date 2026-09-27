import { test, expect, type Page } from "@playwright/test";
import {
    FOR_YOU_DECK_MOCK_PATH,
    packIdentity,
    seedDeckMockHintDismissed,
    waitForMockDeckReady,
} from "./for-you-deck-mock.helpers";

/**
 * FOR-YOU-DECK — deterministic deck behavior via `/mock/for-you-deck`
 * (real ForYouHome / ForYouDeck / ForYouPack, static fixtures).
 *
 * Live `/jobs` integration (Search toggle, Meili corpus) lives in the
 * conditional block at the bottom — opt in with `E2E_LIVE_JOBS_CORPUS=1`.
 */

test.describe("FOR-YOU-DECK — mock fixture (deterministic)", () => {
    test.beforeEach(async ({ page }) => {
        await seedDeckMockHintDismissed(page);
    });

    test("TC-DECK-001: repeated Skip clicks advance to unseen cards", async ({ page }) => {
        await waitForMockDeckReady(page);

        const seen: string[] = [await packIdentity(page)];

        for (let i = 0; i < 2; i++) {
            const skip = page.getByTestId("for-you-skip");
            const previous = seen[seen.length - 1];
            await skip.click();
            if ((await page.getByTestId("for-you-pack").count()) === 0) break;
            await expect(page.getByTestId("for-you-pack").locator("h2")).not.toHaveText(previous, {
                timeout: 10_000,
            });
            const actual = await packIdentity(page);
            expect(seen).not.toContain(actual);
            seen.push(actual);
        }

        expect(seen.length).toBeGreaterThan(1);
    });

    test("TC-DECK-003: wheel over the card never changes active job", async ({ page }) => {
        await waitForMockDeckReady(page);

        const initialJob = await packIdentity(page);
        const card = page.getByTestId("for-you-pack");

        await card.hover();
        await page.mouse.wheel(0, 500);
        await page.waitForTimeout(350);
        await page.mouse.wheel(0, 1000);
        await page.waitForTimeout(350);
        await page.mouse.wheel(0, -1500);
        await page.waitForTimeout(350);

        expect(await packIdentity(page)).toBe(initialJob);
    });

    test("TC-DECK-004: Next and Previous buttons navigate between jobs", async ({ page }) => {
        await waitForMockDeckReady(page);

        const nextBtn = page.getByTestId("for-you-next");
        const prevBtn = page.getByTestId("for-you-previous");

        await expect(prevBtn).toBeDisabled();
        const firstJob = await packIdentity(page);

        await nextBtn.click();
        await expect(page.getByTestId("for-you-pack").locator("h2")).not.toHaveText(firstJob, { timeout: 5000 });
        const secondJob = await packIdentity(page);
        expect(secondJob).not.toBe(firstJob);
        await expect(prevBtn).toBeEnabled();

        await prevBtn.click();
        await expect(page.getByTestId("for-you-pack").locator("h2")).toHaveText(firstJob, { timeout: 5000 });
        await expect(prevBtn).toBeDisabled();
    });

    test("TC-DECK-005: keyboard shortcuts navigate between jobs", async ({ page }) => {
        await waitForMockDeckReady(page);

        const firstJob = await packIdentity(page);

        await page.keyboard.press("ArrowRight");
        await expect(page.getByTestId("for-you-pack").locator("h2")).not.toHaveText(firstJob, { timeout: 5000 });

        await page.keyboard.press("ArrowLeft");
        await expect(page.getByTestId("for-you-pack").locator("h2")).toHaveText(firstJob, { timeout: 5000 });
    });

    test("TC-DECK-006: first-run instruction banner shows and dismisses on Got it", async ({ page }) => {
        await page.goto(FOR_YOU_DECK_MOCK_PATH);
        await expect(page.getByTestId("for-you-deck")).toBeVisible();

        const hint = page.getByText("Getting around");
        await expect(hint).toBeVisible();

        await page.getByRole("button", { name: "Got it" }).click();
        await expect(hint).toHaveCount(0);

        await page.reload();
        await expect(page.getByTestId("for-you-deck")).toBeVisible();
        await expect(page.getByText("Getting around")).toHaveCount(0);
    });

    test("TC-DECK-007: reduced motion still advances with Next", async ({ page }) => {
        await page.emulateMedia({ reducedMotion: "reduce" });
        await waitForMockDeckReady(page);

        const firstJob = await packIdentity(page);
        await page.getByTestId("for-you-next").click();
        await expect(page.getByTestId("for-you-pack").locator("h2")).not.toHaveText(firstJob, { timeout: 5000 });
    });
});

test.describe("FOR-YOU-DECK — live /jobs (corpus-dependent)", () => {
    test.skip(
        process.env.E2E_LIVE_JOBS_CORPUS !== "1",
        "Set E2E_LIVE_JOBS_CORPUS=1 to run against the real jobs index",
    );

    const LOCAL_AI_ENABLED_KEY = "velai.localAi.enabled";
    const LOCAL_AI_RESUME_KEY = "velai.localAi.resume";
    const PACKS_HOME_INTRO_KEY = "velai-packs-home-intro-v1";

    const SEEDED_RESUME = {
        data: {
            profile: {
                name: "Alex Rivera",
                profession: "Software Engineer",
                yearsOfExperience: 6,
                location: "Remote",
                email: "alex.rivera@example.com",
            },
            experience: [
                {
                    id: "exp-1",
                    company: "Acme Corp",
                    role: "Senior Software Engineer",
                    dates: "2021-Present",
                    description: "Built services in TypeScript and Python.",
                },
            ],
            competencies: [{ category: "Languages", skills: ["TypeScript", "Python"] }],
            education: [],
            generatedSummary: "Software engineer.",
        },
        updatedAt: new Date().toISOString(),
        sourceLabel: "e2e-seed",
    };

    async function seedForYouEntry(page: Page) {
        await page.addInitScript(
            ([enabledKey, resumeKey, introKey, resume]) => {
                try {
                    window.localStorage.setItem(enabledKey as string, "1");
                    window.localStorage.setItem(resumeKey as string, JSON.stringify(resume));
                    window.localStorage.setItem(introKey as string, "1");
                } catch {
                    /* private mode */
                }
            },
            [LOCAL_AI_ENABLED_KEY, LOCAL_AI_RESUME_KEY, PACKS_HOME_INTRO_KEY, SEEDED_RESUME] as const,
        );
    }

    async function openDeckFromHub(page: Page) {
        const gotIt = page.getByTestId("packs-home-intro-got-it");
        if (await gotIt.isVisible({ timeout: 1500 }).catch(() => false)) {
            await gotIt.click();
        }
        const browse = page.getByTestId("hub-browse-all-matches");
        if ((await browse.count()) > 0) {
            await browse.click();
        } else {
            await page.getByTestId("hub-pack-card-all").click();
        }
    }

    async function waitForDeckReady(page: Page) {
        await expect(page.getByTestId("job-packs-hub").or(page.getByTestId("for-you-home"))).toBeVisible({
            timeout: 20_000,
        });
        if ((await page.getByTestId("for-you-deck").count()) === 0) {
            await openDeckFromHub(page);
        }
        await expect(page.getByTestId("for-you-home")).toBeVisible({ timeout: 20_000 });
        await expect(page.getByTestId("for-you-loading")).toHaveCount(0, { timeout: 20_000 });
        await expect(page.getByTestId("for-you-pack").first()).toBeVisible({ timeout: 20_000 });
    }

    test("TC-DECK-002: toggling Search -> For-you keeps the same job active", async ({ page }) => {
        await seedForYouEntry(page);
        await seedDeckMockHintDismissed(page);
        await page.goto("/jobs");
        await waitForDeckReady(page);

        await page.getByTestId("for-you-skip").click();
        await expect(page.getByTestId("for-you-pack").first()).toBeVisible();
        const beforeToggle = await packIdentity(page);

        await page.getByRole("tab", { name: "Search all jobs" }).click();
        await expect(page.getByTestId("for-you-home")).toHaveCount(0);

        await page.getByRole("tab", { name: "For you · résumé" }).click();
        await waitForDeckReady(page);
        const afterToggle = await packIdentity(page);

        expect(afterToggle).toBe(beforeToggle);
    });
});

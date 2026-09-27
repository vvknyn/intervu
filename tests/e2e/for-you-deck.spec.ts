import { test, expect, type Page } from "@playwright/test";
import {
    FOR_YOU_DECK_MOCK_PATH,
    deckRestingPack,
    deckRestingPackHeading,
    restingPackTitle,
    seedDeckMockHintDismissed,
    waitForDeckRestingState,
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
        await page.emulateMedia({ reducedMotion: "no-preference" });
    });

    test("TC-DECK-001: repeated Skip clicks advance to unseen cards", async ({ page }) => {
        await waitForMockDeckReady(page);

        const seen: string[] = [await restingPackTitle(page)];

        for (let i = 0; i < 2; i++) {
            const skip = page.getByTestId("for-you-skip");
            const previous = seen[seen.length - 1];
            await skip.click();
            if ((await page.getByTestId("for-you-pack").count()) === 0) break;
            await waitForDeckRestingState(page);
            const actual = await restingPackTitle(page);
            expect(actual).not.toBe(previous);
            expect(seen).not.toContain(actual);
            seen.push(actual);
        }

        expect(seen.length).toBeGreaterThan(1);
    });

    test("TC-DECK-003: wheel over the card never changes active job", async ({ page }) => {
        await waitForMockDeckReady(page);

        const initialJob = await restingPackTitle(page);
        const card = deckRestingPack(page);

        await card.hover();
        await page.mouse.wheel(0, 500);
        await page.waitForTimeout(350);
        await page.mouse.wheel(0, 1000);
        await page.waitForTimeout(350);
        await page.mouse.wheel(0, -1500);
        await page.waitForTimeout(350);

        expect(await restingPackTitle(page)).toBe(initialJob);
    });

    test("TC-DECK-004: choosing another row changes the open role", async ({ page }) => {
        await waitForMockDeckReady(page);

        const firstJob = await restingPackTitle(page);
        const rows = page.getByTestId("job-row");
        await rows.nth(1).click();
        await waitForDeckRestingState(page);
        const secondJob = await restingPackTitle(page);
        expect(secondJob).not.toBe(firstJob);

        await rows.nth(0).click();
        await waitForDeckRestingState(page);
        await expect(deckRestingPackHeading(page)).toHaveText(firstJob, { timeout: 5000 });
    });

    test("TC-DECK-005: keyboard shortcuts navigate between jobs", async ({ page }) => {
        await waitForMockDeckReady(page);

        const firstJob = await restingPackTitle(page);

        await page.keyboard.press("ArrowRight");
        await waitForDeckRestingState(page);
        await expect(deckRestingPackHeading(page)).not.toHaveText(firstJob, { timeout: 5000 });

        await page.keyboard.press("ArrowLeft");
        await waitForDeckRestingState(page);
        await expect(deckRestingPackHeading(page)).toHaveText(firstJob, { timeout: 5000 });
    });

    test("TC-DECK-007: reduced motion still advances with Next", async ({ page }) => {
        await page.emulateMedia({ reducedMotion: "reduce" });
        await waitForMockDeckReady(page);

        const firstJob = await restingPackTitle(page);
        await page.getByTestId("job-row").nth(1).click();
        await waitForDeckRestingState(page);
        await expect(deckRestingPackHeading(page)).not.toHaveText(firstJob, { timeout: 5000 });
    });
});

test.describe("FOR-YOU-DECK — mock fixture hint banner", () => {
    test.beforeEach(async ({ page }) => {
        // Intentionally no hint-dismiss seed — sibling suite sets it; fresh storage shows the banner.
        await page.emulateMedia({ reducedMotion: "no-preference" });
    });

    test("TC-DECK-006: the deck has no coach strip", async ({ page }) => {
        await page.goto(FOR_YOU_DECK_MOCK_PATH);
        await waitForDeckRestingState(page);
        await expect(page.getByText("Getting around")).toHaveCount(0);
        await expect(page.getByTestId("job-row").first()).toBeVisible();
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
        await waitForDeckRestingState(page);
    }

    test("TC-DECK-002: toggling Search -> For-you keeps the same job active", async ({ page }) => {
        await seedForYouEntry(page);
        await seedDeckMockHintDismissed(page);
        await page.goto("/jobs");
        await waitForDeckReady(page);

        await page.getByTestId("for-you-skip").click();
        await waitForDeckRestingState(page);
        const beforeToggle = await restingPackTitle(page);

        await page.getByRole("tab", { name: "Search all jobs" }).click();
        await expect(page.getByTestId("for-you-home")).toHaveCount(0);

        await page.getByRole("tab", { name: "For you · résumé" }).click();
        await waitForDeckReady(page);
        const afterToggle = await restingPackTitle(page);

        expect(afterToggle).toBe(beforeToggle);
    });
});

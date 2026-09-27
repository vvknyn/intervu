import { test, expect } from "@playwright/test";

const LOCAL_AI_ENABLED_KEY = "velai.localAi.enabled";
const LOCAL_AI_RESUME_KEY = "velai.localAi.resume";
const ONBOARDING_KEY = "velai.onboarding.completed";
const FIRST_REVEAL_KEY = "velai.firstPackReveal";

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

test.describe("first pack reveal latch", () => {
    test("armed session opens deck from hub after fit resolves", async ({ page }) => {
        await page.addInitScript(
            ([enabledKey, resumeKey, onboardingKey, revealKey, resume]) => {
                try {
                    window.localStorage.setItem(enabledKey as string, "1");
                    window.localStorage.setItem(resumeKey as string, JSON.stringify(resume));
                    window.localStorage.setItem(onboardingKey as string, "1");
                    window.sessionStorage.setItem(revealKey as string, "1");
                } catch {
                    /* private mode */
                }
            },
            [LOCAL_AI_ENABLED_KEY, LOCAL_AI_RESUME_KEY, ONBOARDING_KEY, FIRST_REVEAL_KEY, SEEDED_RESUME] as const,
        );

        await page.goto("/jobs");
        await expect(page.getByTestId("for-you-deck")).toBeVisible({ timeout: 25_000 });
        await expect(page.getByTestId("for-you-download-apply")).toBeFocused({ timeout: 10_000 });
    });
});

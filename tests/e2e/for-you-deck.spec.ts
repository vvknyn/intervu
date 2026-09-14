import { test, expect, type Page } from "@playwright/test";

/**
 * TEST GROUP: FOR-YOU-DECK — the deck must advance by exactly one card per
 * Skip, and must not lose its place across a Search <-> For-you toggle.
 *
 * Pins two defects from scratchpad/ledger-foryou.md:
 *   - P0 "Deck stops advancing entirely after one Search <-> For-you toggle
 *     round-trip" (repro: navigate a few cards in, toggle Search -> For-you,
 *     click Skip repeatedly, frozen at "1 of N" forever).
 *   - P1 "Search <-> For-you toggle silently discards deck progress."
 *
 * Reaching a real For-you deck needs no credentials and no cloud LLM call —
 * but it does need staying SIGNED OUT: `page.tsx`'s local-résumé hydration
 * effect (`if (user) return;`) only reads `velai.localAi.resume` for a
 * signed-out guest ("R&D local mode"); a signed-in user's résumé comes from
 * a server action instead, which is not worth mocking here. So this seeds
 * two guest-only localStorage flags before first paint: `velai.localAi.
 * enabled` (`LOCAL_AI_ENABLED_KEY`, `lib/local-ai/flag.ts`) and `velai.
 * localAi.resume` (`LOCAL_AI_RESUME_KEY`, `lib/local-ai/resume-storage.ts`).
 * Together they make `hasUsableResume` (`resumeIsUsable(resume)`) true on
 * first render — the same local, session-only path a real paste-and-parse
 * import takes — no `ResumeImportModal` UI, and no `__INTERVU_E2E_AUTH__`
 * sign-in mock, needs driving. `resumeOnFile === true` with no
 * search-forcing URL params (`home-view.ts`) then resolves straight to the
 * For-you branch on a plain `/jobs` navigation.
 *
 * The deck's real Skip control is `data-testid="for-you-skip"`
 * (`ForYouHome.tsx`) — NOT the accessibility "Skip to results" anchor link
 * elsewhere on the page, which shares the word "Skip" in its text but is an
 * unrelated `<a href="#jobs-results-list">`. A selector that matched on
 * visible "Skip" text alone could click that anchor instead of the deck's
 * control, which is one plausible source of a false "frozen deck" report.
 */

const LOCAL_AI_ENABLED_KEY = "velai.localAi.enabled";
const LOCAL_AI_RESUME_KEY = "velai.localAi.resume";

/** Generic enough to match real postings in whatever jobs index this runs
 *  against, without depending on any fixture/seed data existing. */
const SEEDED_RESUME = {
    data: {
        profile: {
            name: "Alex Rivera",
            profession: "Software Engineer",
            yearsOfExperience: 6,
            location: "Remote",
            email: "alex.rivera@example.com",
            phone: "555-010-1000",
        },
        experience: [
            {
                id: "exp-1",
                company: "Acme Corp",
                role: "Senior Software Engineer",
                dates: "2021-Present",
                description:
                    "Built and shipped backend services in Python and TypeScript; led React frontend work.",
            },
            {
                id: "exp-2",
                company: "Globex Inc",
                role: "Software Engineer",
                dates: "2018-2021",
                description: "Full-stack engineering in JavaScript, SQL, and AWS.",
            },
        ],
        competencies: [
            { category: "Languages", skills: ["JavaScript", "TypeScript", "Python", "SQL"] },
            { category: "Cloud", skills: ["AWS", "Docker", "Kubernetes"] },
        ],
        education: [
            { id: "edu-1", degree: "B.S. Computer Science", institution: "State University", year: "2018" },
        ],
        generatedSummary: "Software engineer with 6 years of experience across backend and frontend systems.",
    },
    updatedAt: new Date().toISOString(),
    sourceLabel: "e2e-seed",
};

/** Seeds the guest local-AI résumé BEFORE any page script runs, so first
 *  render already resolves `resumeOnFile === true` and the For-you branch —
 *  no UI flow (login, résumé import) needs driving. Stays signed out on
 *  purpose (see the file-level doc comment). */
async function seedForYouEntry(page: Page) {
    await page.addInitScript(
        ([enabledKey, resumeKey, resume]) => {
            try {
                window.localStorage.setItem(enabledKey as string, "1");
                window.localStorage.setItem(resumeKey as string, JSON.stringify(resume));
            } catch {
                /* private mode */
            }
        },
        [LOCAL_AI_ENABLED_KEY, LOCAL_AI_RESUME_KEY, SEEDED_RESUME] as const,
    );
}

/** The active card's identity, read straight off the DOM rather than any
 *  internal index: company + title text of the FIRST `for-you-pack` node.
 *  `ForYouDeck` renders the active card plus up to two upcoming preview
 *  cards in ascending `packs` order (offset 0, 1, 2), so `.first()` /
 *  `.nth(1)` are the active card and the card one Skip away, respectively. */
function packIdentity(page: Page, nth: number) {
    const pack = page.getByTestId("for-you-pack").nth(nth);
    return pack.locator("h2").innerText();
}

async function waitForDeckReady(page: Page) {
    await expect(page.getByTestId("for-you-home")).toBeVisible({ timeout: 20_000 });
    // Loading/empty are mutually exclusive with a rendered deck; give the
    // résumé-match fetch time to resolve into real packs.
    await expect(page.getByTestId("for-you-loading")).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByTestId("for-you-pack").first()).toBeVisible({ timeout: 20_000 });
}

test.describe("FOR-YOU-DECK — Skip advances exactly one card and survives a view toggle", () => {
    test("TC-DECK-001: repeated Skip clicks each advance the active job by exactly one card", async ({ page }) => {
        await seedForYouEntry(page);
        await page.goto("/jobs");
        await waitForDeckReady(page);

        const skip = page.getByTestId("for-you-skip");
        const seen: string[] = [await packIdentity(page, 0)];

        for (let i = 0; i < 4; i++) {
            const packCount = await page.getByTestId("for-you-pack").count();
            if (packCount < 2) break; // ran out of preview cards to prove "next" against
            const expectedNext = await packIdentity(page, 1);
            await skip.click();
            await expect(page.getByTestId("for-you-pack").first()).toHaveText(
                new RegExp(expectedNext.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
                { timeout: 10_000 },
            );
            const actual = await packIdentity(page, 0);
            expect(actual, `Skip #${i + 1} must land on the card that was next, not stay put or jump`).toBe(
                expectedNext,
            );
            expect(seen, `Skip #${i + 1} landed on an already-seen job — deck is not advancing`).not.toContain(
                actual,
            );
            seen.push(actual);
        }

        expect(seen.length, "no Skip actually advanced the deck").toBeGreaterThan(1);
    });

    test("TC-DECK-002: toggling Search -> For-you keeps the same job active", async ({ page }) => {
        await seedForYouEntry(page);
        await page.goto("/jobs");
        await waitForDeckReady(page);

        const skip = page.getByTestId("for-you-skip");
        // Move a couple of cards in first, so we're not trivially asserting
        // against card #1 (the state-persistence bug only shows up once
        // there's real progress to lose).
        await skip.click();
        await expect(page.getByTestId("for-you-pack").first()).toBeVisible();
        const beforeToggle = await packIdentity(page, 0);

        await page.getByRole("tab", { name: "Search" }).click();
        await expect(page.getByTestId("for-you-home")).toHaveCount(0);

        await page.getByRole("tab", { name: "For you" }).click();
        await waitForDeckReady(page);
        const afterToggle = await packIdentity(page, 0);

        expect(afterToggle, "toggling views must not reset or advance the active job").toBe(beforeToggle);
    });
});

import type { Page } from "@playwright/test";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { LOCAL_AI_RESUME_KEY } from "../../../src/lib/local-ai/resume-storage";
import { expect, test } from "./fixtures";
import { runSearch } from "./search-box";

/**
 * Journeys for the signed-out gates — see tests/journeys/CATALOG.md
 * (J-JOBS-06/07/32/33/34/35/36/59, J-DETAIL-24/28, J-COMPANY-13). Every gate is the one `SignupGate`
 * card (`data-testid="signup-gate"`, `data-gate-reason=<reason>`): it names the
 * action, offers "Create free account" (signup-mode /auth/start) and
 * "Sign in" (/login), both carrying the page in `next=`. Read-only: nothing
 * here creates an account, saves to the server or sends email.
 */

const returningVisitor = (page: Page) =>
  page.addInitScript((key) => localStorage.setItem(key, "1"), ONBOARDING_COMPLETED_STORAGE_KEY);

const gate = (page: Page, reason: string) => page.locator(`[data-testid="signup-gate"][data-gate-reason="${reason}"]`);

async function searchFor(page: Page, keyword: string) {
  await returningVisitor(page);
  await page.goto("/jobs");
  const input = page.getByPlaceholder("Job title, skill, or company");
  await input.fill(keyword);
  await runSearch(page, input);
  await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 30_000 });
}

/** One primary door, one secondary, and both bring the visitor back to `returnTo`. */
async function expectDoors(page: Page, reason: string, returnToPattern: RegExp) {
  const card = gate(page, reason);
  await expect(card.getByTestId("signup-gate-create")).toHaveText("Create free account");
  await expect(card.getByTestId("signup-gate-signin")).toHaveText("Sign in");
  const create = (await card.getByTestId("signup-gate-create").getAttribute("href")) ?? "";
  const signIn = (await card.getByTestId("signup-gate-signin").getAttribute("href")) ?? "";
  expect(create).toMatch(/^\/auth\/start\?mode=signup&next=/);
  expect(signIn).toMatch(/^\/login\?next=/);
  expect(decodeURIComponent(create.split("next=")[1])).toMatch(returnToPattern);
  expect(decodeURIComponent(signIn.split("next=")[1])).toMatch(returnToPattern);
}

/**
 * Pages with "Show N more", one page per click, until the wall. Not by scrolling: the list's
 * IntersectionObserver fires only when the sentinel enters range, so a page that leaves the
 * sentinel in range (or a scroll that is a no-op) loads nothing more, and the wait became a race.
 * The button renders only while no page is loading and the wall is not up.
 */
async function reachDepthWall(page: Page) {
  await searchFor(page, "engineer");
  const wall = gate(page, "depth");
  const more = page.getByTestId("jobs-load-more");
  await expect
    .poll(
      async () => {
        // A page load can start between the check and the click; the next poll re-checks.
        if (await more.isVisible()) await more.click({ timeout: 2_000 }).catch(() => undefined);
        return wall.isVisible();
      },
      { timeout: 45_000, message: "page the list until the anonymous depth wall" },
    )
    .toBe(true);
  return wall;
}

test("depth wall states the true hidden count and offers Create free account", { tag: ["@J-JOBS-06"] }, async ({ page, diagnostics }) => {
  const wall = await reachDepthWall(page);
  await expect(wall.getByRole("heading")).toHaveText(/^See the other [\d,]+\+? roles that match$/);
  await expect(wall.getByTestId("signup-gate-create")).toBeVisible();
  // A hard wall: no "Not now".
  await expect(wall.getByTestId("signup-gate-dismiss")).toHaveCount(0);
  expect(diagnostics.pageErrors).toEqual([]);
});

test("depth-wall doors carry the current search in next=", { tag: ["@J-JOBS-07"] }, async ({ page }) => {
  await reachDepthWall(page);
  await expectDoors(page, "depth", /^\/jobs\?.*q=engineer/);
});

// The toolbar's Save search became the results line's Job alert switch (2026-10-22); a guest's toggle opens the email form, so this gate has no entry point left.
test.fixme("a guest's second saved search meets the save-search gate, not a bare input", { tag: ["@J-JOBS-32"] }, async ({ page }) => {
  // One save already made on this device: the next one needs an account.
  await page.addInitScript(() => localStorage.setItem("intervu.guestSaveCount", "1"));
  await searchFor(page, "engineer");
  await page.getByTestId("save-search-trigger").click();
  await expect(gate(page, "alert").getByRole("heading")).toHaveText("Save this search");
  await expect(page.getByTestId("save-search-name")).toHaveCount(0);
  await expectDoors(page, "alert", /^\/jobs\?.*q=engineer/);
});

test("a guest's first job save shows the dismissible save gate", { tag: ["@J-JOBS-33"] }, async ({ page }) => {
  await searchFor(page, "engineer");
  await page.getByTestId("job-row").first().getByTestId("job-save-trigger").click();
  const banner = page.getByTestId("guest-save-banner");
  await expect(banner).toBeVisible();
  await expect(gate(page, "save")).toBeVisible();
  await expectDoors(page, "save", /^\/jobs\?.*q=engineer/);
  await gate(page, "save").getByTestId("signup-gate-dismiss").click();
  await expect(banner).toHaveCount(0);
});

const SYNTHETIC_RESUME = {
  profile: {
    name: "Sam Rivera",
    profession: "Senior Software Engineer",
    yearsOfExperience: 7,
    location: "San Francisco, CA",
    email: "sam.rivera.dev@example.com",
    phone: "555-010-1234",
    linkedin: "",
    website: "",
  },
  experience: [
    {
      id: "exp1",
      company: "Nimbus Data",
      role: "Senior Software Engineer",
      dates: "2021 - Present",
      description: "Built and scaled backend services in TypeScript/Node and Go on AWS. Mentored 3 junior engineers.",
    },
  ],
  competencies: [{ category: "Languages", skills: ["TypeScript", "JavaScript", "Go", "Python", "SQL"] }],
  education: [{ id: "edu1", degree: "B.S. Computer Science", institution: "State University", year: "2018" }],
  generatedSummary: "Senior software engineer with 7 years of experience building backend and full-stack systems.",
};

/** The fit gate after exactly the top 3 ranked rows. */
async function expectTopThreeThenFitGate(page: Page) {
  const card = gate(page, "fit");
  await expect(card).toBeVisible({ timeout: 45_000 });
  await expect(card.getByRole("heading")).toHaveText(/^See all ([\d,]+\+? matches ranked for you|your ranked matches)$/);
  await expect(page.getByTestId("job-row")).toHaveCount(3);
  await expectDoors(page, "fit", /^\/jobs\?.*sort=fit/);
  await expect(card.getByTestId("signup-gate-dismiss")).toBeVisible();
}

// No local-AI flag: a guest's résumé kept in this browser ranks by default.
const seedGuestResume = (page: Page) =>
  page.addInitScript(
    ([resumeKey, resume]) => {
      localStorage.setItem(resumeKey as string, JSON.stringify({ data: resume, updatedAt: new Date().toISOString(), sourceLabel: "e2e-synthetic" }));
    },
    [LOCAL_AI_RESUME_KEY, SYNTHETIC_RESUME] as const,
  );

test("a guest with a résumé sees their top 3 matches, then the fit gate", { tag: ["@J-JOBS-34"] }, async ({ page }) => {
  await returningVisitor(page);
  await seedGuestResume(page);
  await page.goto("/jobs?sort=fit");
  await expectTopThreeThenFitGate(page);
});

test("a guest who opens an old For you link gets their ranked list, top 3 and the fit gate, with no packs hub", { tag: ["@J-JOBS-35"] }, async ({ page }) => {
  await returningVisitor(page);
  await seedGuestResume(page);
  await page.goto("/jobs?view=for-you");
  // The link's view is ignored: the list opens on the résumé's matches.
  await expectTopThreeThenFitGate(page);
  await expect(page).toHaveURL(/[?&]sort=fit/);
  await expect(gate(page, "packs")).toHaveCount(0);
  await expect(page.locator('[data-testid^="hub-pack-card-"]')).toHaveCount(0);
  await expect(page.getByTestId("for-you-home")).toHaveCount(0);
  // Settle: nothing else paints behind the card once the page is idle.
  await page.waitForTimeout(3_000);
  await expect(page.getByTestId("job-row")).toHaveCount(3);
  await expect(page.getByPlaceholder("Job title, skill, or company").first()).toBeVisible();
});

test("a guest with a résumé in this browser lands on their top 3 matches and the fit gate", { tag: ["@J-JOBS-59"] }, async ({ page }) => {
  await returningVisitor(page);
  await seedGuestResume(page);
  await page.goto("/jobs");
  await expect(page.getByPlaceholder("Job title, skill, or company").first()).toBeVisible({ timeout: 45_000 });
  await expectTopThreeThenFitGate(page);
  await expect(page.locator('[data-testid^="hub-pack-card-"]')).toHaveCount(0);
});

/** Two first-run résumés: the review shows each one's own title and location, and ranking applies them. */
const FIRST_RUN_RESUMES = [
  {
    name: "toronto-analyst",
    title: "Senior Data Analyst",
    location: "Toronto, ON, Canada",
    country: "Canada",
    text: [
      "Priya Raman",
      "Senior Data Analyst",
      "priya.raman.e2e@example.com | Toronto, ON, Canada",
      "",
      "EXPERIENCE",
      "Senior Data Analyst, Northwind Financial",
      "2021 - Present",
      "- Built SQL and Python pipelines feeding weekly revenue dashboards.",
      "",
      "Data Analyst, Maple Retail",
      "2016 - 2021",
      "- Owned Tableau reporting for 40 stores.",
      "",
      "EDUCATION",
      "B.Sc. Statistics, University of Toronto, 2016",
      "",
      "SKILLS",
      "SQL, Python, Tableau, dbt, Looker",
    ].join("\n"),
  },
  {
    name: "austin-engineer",
    title: "Senior Software Engineer",
    location: "Austin, TX",
    country: "United States",
    text: [
      "Jordan Ellis",
      "Senior Software Engineer",
      "jordan.ellis.e2e@example.com | Austin, TX",
      "",
      "EXPERIENCE",
      "Senior Software Engineer, Lonestar Cloud",
      "2020 - Present",
      "- Built TypeScript and Go services on AWS serving 2M requests a day.",
      "",
      "Software Engineer, Pecan Labs",
      "2015 - 2020",
      "- Shipped React front ends and Node APIs.",
      "",
      "EDUCATION",
      "B.S. Computer Science, University of Texas at Austin, 2015",
      "",
      "SKILLS",
      "TypeScript, Go, React, Node.js, AWS, PostgreSQL",
    ].join("\n"),
  },
];

for (const resume of FIRST_RUN_RESUMES) {
  test(`first-run guest upload (${resume.name}) reviews title + location, ranks the Search board there, then top 3 + fit gate`, { tag: ["@J-JOBS-36"] }, async ({ page }) => {
    await page.goto("/jobs");
    await page.getByRole("button", { name: "Upload résumé" }).first().click({ timeout: 60_000 });
    const dialog = page.getByRole("dialog");
    await dialog.locator('input[type="file"]').setInputFiles({ name: `${resume.name}.txt`, mimeType: "text/plain", buffer: Buffer.from(resume.text) });
    await dialog.getByTestId("resume-import-parse-primary").click();
    await expect(dialog.getByLabel("Job title", { exact: true })).toHaveValue(resume.title, { timeout: 30_000 });
    await expect(dialog.getByLabel("Location", { exact: true })).toHaveValue(resume.location);
    await dialog.getByRole("button", { name: "Rank my jobs" }).click();
    await expect(page).toHaveURL(new RegExp(`country=${encodeURIComponent(resume.country).replace(/%20/g, "(\\+|%20)")}.*sort=fit|sort=fit.*country=`));
    expect(new URL(page.url()).searchParams.get("country")).toBe(resume.country);
    // The guest's résumé ranks the list: top 3, then the gate.
    await expectTopThreeThenFitGate(page);
    await expect(page.locator('[data-testid^="hub-pack-card-"]')).toHaveCount(0);
  });
}

test("signed-out Report listing opens the report form with no sign-in", { tag: ["@J-DETAIL-24"] }, async ({ page }) => {
  await searchFor(page, "engineer");
  const path = await page.getByTestId("job-row").first().locator('a[href^="/jobs/"]').first().getAttribute("href");
  await page.goto(path!);
  const trigger = page.getByTestId("report-job-trigger").and(page.locator(":visible"));
  test.skip((await trigger.count()) === 0, "report flag is off in this environment, so no trigger renders");
  await trigger.first().click();
  await expect(page.getByTestId("report-job-dialog")).toBeVisible();
  await expect(page.getByTestId("report-job-submit")).toBeEnabled();
  await expect(page.getByTestId("signup-gate")).toHaveCount(0);
  await expect(page.getByRole("dialog").filter({ hasText: /create account|sign in/i })).toHaveCount(0);
});

test("an anonymous Report submit reaches 'Reported ✓' @writes", { tag: ["@J-DETAIL-28", "@writes"] }, async ({ page }) => {
  // Writes one flag row (keyed by an IP hash) — run only with JOURNEYS_ALLOW_WRITES=1.
  await searchFor(page, "engineer");
  const path = await page.getByTestId("job-row").first().locator('a[href^="/jobs/"]').first().getAttribute("href");
  await page.goto(path!);
  const trigger = page.getByTestId("report-job-trigger").and(page.locator(":visible"));
  test.skip((await trigger.count()) === 0, "report flag is off in this environment, so no trigger renders");
  await trigger.first().click();
  await page.getByTestId("report-job-submit").click();
  await expect(page.getByTestId("report-job-done")).toBeVisible({ timeout: 15_000 });
});

test("a guest's Follow offers the email step and 'Have an account? Sign in' opens the auth dialog", { tag: ["@J-COMPANY-13"] }, async ({ page }) => {
  await page.goto("/co/anthropic--com");
  const follow = page.getByTestId("follow-company");
  test.skip(!(await follow.isVisible({ timeout: 30_000 }).catch(() => false)), "company page unavailable in this build");
  await follow.click();
  const emailStep = page.getByTestId("follow-email-step");
  await expect(emailStep).toBeVisible();
  // Focusable, never submitted: a live Turnstile means no e2e submission.
  await page.getByTestId("follow-email-input").focus();
  await expect(page.getByTestId("follow-email-input")).toBeFocused();
  await page.getByTestId("follow-email-signin").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(emailStep).not.toBeVisible();
  await expect(follow).toHaveAttribute("data-following", "false");
});

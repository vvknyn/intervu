import type { Page } from "@playwright/test";
import { JOBS_VISITOR_COOKIE } from "../../../src/lib/jobs-visitor-cookie";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { PACKS_HOME_INTRO_KEY } from "../../../src/lib/jobs/for-you/packs-home-intro";
import { TODAY_NEW_ROWS } from "../../../src/lib/jobs/for-you/today";
import { SEARCH_UNAVAILABLE_MESSAGE } from "../../../src/lib/jobs/result-state";
import { DEFAULT_URL_STATE } from "../../../src/lib/jobs/url-state";
import { expect, test } from "./fixtures";
import { signedInTest, withoutMockSignInHydration } from "./signed-in";

// Résumé kept in this browser: src/lib/local-ai/flag.ts + resume-storage.ts (same seeding tests/e2e/jobs-first-paint.spec.ts proves).
const LOCAL_AI_ENABLED_KEY = "velai.localAi.enabled";
const LOCAL_AI_RESUME_KEY = "velai.localAi.resume";

/** Journeys for the /jobs area — see tests/journeys/CATALOG.md (J-JOBS-01/23/24/25/26/27/31/37/38/39/40/41/43/44/47/48/50/51/52/54/55/56/57/58/60, J-SRCH-03, J-SRCH-21, J-DETAIL-01). Read-only. */

const returningVisitor = (page: Page) =>
  page.addInitScript((key) => localStorage.setItem(key, "1"), ONBOARDING_COMPLETED_STORAGE_KEY);

async function searchFor(page: Page, keyword: string) {
  await returningVisitor(page);
  await page.goto("/jobs");
  await page.getByPlaceholder("Job title, skill, or company").fill(keyword);
  await page.getByTestId("search-submit").click();
  await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 30_000 });
}

const FIRST_PAINT_MS = 5_000;
const SEARCH_INPUT = 'input[placeholder="Job title, skill, or company"]';
const POSTER = '#concept-a-ssr, [data-testid="concept-a-landing"]';

async function expectBoard(page: Page, timeout = FIRST_PAINT_MS) {
  await expect(page.locator(SEARCH_INPUT).first()).toBeVisible({ timeout });
  await expect
    .poll(() => page.getByTestId("job-row").count(), { timeout, message: "job rows on first paint" })
    .toBeGreaterThanOrEqual(5);
}

/** The résumé-upload band a visitor with no résumé gets at rest (FrontDoorResumeBand). */
const RESUME_BAND = 'section[aria-label="Add your resume"]';

/**
 * Bare /jobs at rest is a front door, not a list: the search box, one h1, the résumé band,
 * and no job rows. The rows are checked after the page has had time to fetch any, so a list
 * that arrives late still fails.
 */
async function expectFrontDoor(page: Page, timeout = FIRST_PAINT_MS) {
  await expect(page.locator(SEARCH_INPUT).first()).toBeVisible({ timeout });
  await expect(page.locator(RESUME_BAND)).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(3_000);
  await expect(page.getByTestId("job-row")).toHaveCount(0);
}

/**
 * The résumé-ranked list is a recommendation, so it keeps the packs' 30-day window whatever the
 * typed-search default is: no `posted` param while 30 days is the default, `posted=30d` once it isn't.
 */
async function expectPackWindow(page: Page) {
  if (DEFAULT_URL_STATE.postedBucket === "30d") await expect(page).not.toHaveURL(/[?&]posted=/);
  else await expect(page).toHaveURL(/[?&]posted=30d\b/);
}

/** Fresh = empty storage. Previous-session = the visit cookie is set but velai.onboarding.completed is not. */
const VISITORS = [
  { name: "fresh visitor", previousSession: false },
  { name: "previous-session visitor (onboarding flag unset)", previousSession: true },
];

async function openJobs(page: Page, baseURL: string | undefined, previousSession: boolean, path = "/jobs") {
  if (previousSession) await page.context().addCookies([{ name: JOBS_VISITOR_COOKIE, value: "1", url: baseURL! }]);
  await page.goto(path);
}

test("first-time visitor opens /jobs and sees the front door: search box, one h1, the week's count, the résumé band, no job rows", { tag: ["@J-JOBS-01"] }, async ({ page, diagnostics }) => {
  const res = await page.goto("/jobs");
  expect(res?.status()).toBe(200);
  await expectFrontDoor(page);
  await expect(page.getByTestId("front-door-week-count")).toContainText(/^[\d,]+\+? roles? posted this week/, { timeout: 15_000 });
  await expect(page.locator(POSTER)).toHaveCount(0);
  await expect(page.locator("h1:visible")).toHaveCount(1);
  await expect(page.getByTestId("signup-gate")).toHaveCount(0);
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

test("a guest taps the week's count on the front door and gets that week's roles", { tag: ["@J-JOBS-60"] }, async ({ page, diagnostics }) => {
  await page.goto("/jobs");
  const count = page.getByTestId("front-door-week-count");
  await expect(count).toBeVisible({ timeout: 15_000 });
  await count.click();
  await expect(page).toHaveURL(/[?&]posted=7d/);
  await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 30_000 });
  expect(diagnostics.serverErrors).toEqual([]);
});

for (const visitor of VISITORS) {
  test(`${visitor.name} searches, clicks a row title and the job detail opens`, { tag: ["@J-JOBS-23"] }, async ({ page, baseURL }) => {
    await openJobs(page, baseURL, visitor.previousSession, "/jobs?q=engineer");
    await expectBoard(page, 30_000);
    // The row centre is the company link; the title is the detail affordance.
    await page.getByTestId("job-row").getByTestId("job-title").first().click();
    await expect(page).toHaveURL(/[?&]job=/, { timeout: 10_000 });
    await expect(page.locator('[data-testid="detail-pane"]:visible, [data-testid="mobile-detail-scroller"]:visible').first()).toBeVisible();
  });

  test(`${visitor.name} clicks Sign in or Get started and the front door is still there 2s later`, { tag: ["@J-JOBS-24"] }, async ({ page, baseURL }) => {
    await openJobs(page, baseURL, visitor.previousSession);
    await expectFrontDoor(page);
    // By accessible name, so any visible entry point counts, not one testid.
    const cta = page
      .getByRole("button", { name: /^(sign in|get started)$/i })
      .or(page.getByRole("link", { name: /^(sign in|get started)$/i }));
    await expect(cta.first()).toBeVisible();
    await cta.first().click();
    await page.waitForTimeout(2_000);
    await expect(page.locator(SEARCH_INPUT).first()).toBeVisible({ timeout: 1_000 });
    await expect(page.locator(POSTER)).toHaveCount(0);
  });
}

test("list analytics fire: results_impressed on first render, search_submitted on a search", { tag: ["@J-JOBS-25"] }, async ({ page }) => {
  test.skip(!process.env.NEXT_PUBLIC_POSTHOG_KEY, "build has no NEXT_PUBLIC_POSTHOG_KEY, so captureEvent is a no-op");
  // The fixture aborts /api/telemetry; a page-level route wins, so answer it locally and read the event names.
  // Nothing leaves the browser: captureEvent's ledger POST is the carrier and it is fulfilled here.
  const events: string[] = [];
  await page.route("**/api/telemetry", async (route) => {
    const body = route.request().postDataJSON() as { events?: { event_name: string }[] };
    for (const e of body.events ?? []) events.push(e.event_name);
    await route.fulfill({ status: 204 });
  });
  await page.goto("/jobs?q=engineer");
  await expectBoard(page, 30_000);
  await expect.poll(() => events, { timeout: 15_000, message: "results_impressed after first render" }).toContain("results_impressed");

  await page.locator(SEARCH_INPUT).first().fill("analyst");
  await page.locator(SEARCH_INPUT).first().press("Enter");
  await expect.poll(() => events, { timeout: 15_000, message: "search_submitted after a search" }).toContain("search_submitted");
});

test("returning visitor searches a keyword and gets job rows", { tag: ["@J-SRCH-03"] }, async ({ page, diagnostics }) => {
  await searchFor(page, "engineer");
  await expect(page).toHaveURL(/[?&]q=engineer/);
  await expect(page.getByTestId("job-title").first()).not.toBeEmpty();
  expect(diagnostics.serverErrors).toEqual([]);
});

test("a job page opened directly renders one h1 and an Apply button", { tag: ["@J-DETAIL-01"] }, async ({ page, diagnostics }) => {
  // Slug is sourced from live search results — pinned slugs rot when listings expire.
  await searchFor(page, "engineer");
  const path = await page.getByTestId("job-row").first().locator('a[href^="/jobs/"]').first().getAttribute("href");
  const res = await page.goto(path!);
  expect(res?.status()).toBe(200);
  await expect(page.locator("h1:visible")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /apply/i }).and(page.locator(":visible"))).toHaveCount(1);
  expect(diagnostics.serverErrors).toEqual([]);
});

test("returning visitor's search session throws no uncaught page errors", { tag: ["@J-SRCH-21"] }, async ({ page, diagnostics }) => {
  await searchFor(page, "engineer");
  expect(diagnostics.pageErrors).toEqual([]);
});

/**
 * Fabricated candidate (no real person) whose résumé location is `location`, kept in this browser.
 * For you needs an account, so the pack journeys below run signed in (`signedInTest`); an account
 * with no résumé on file ranks this one.
 */
const withResume = (page: Page, location: string) =>
  page.addInitScript(
    ([enabledKey, resumeKey, location]) => {
      const resume = {
        profile: { name: "Sam Rivera", profession: "Software Engineer", yearsOfExperience: 4, location, email: "sam.rivera.dev@example.com", phone: "555-010-1234", linkedin: "", website: "" },
        experience: [{ id: "exp1", company: "Nimbus Data", role: "Software Engineer", dates: "2021 - Present", description: "Built backend services in TypeScript and Node." }],
        competencies: [{ category: "Languages", skills: ["TypeScript", "JavaScript", "Python", "SQL"] }],
        education: [{ id: "edu1", degree: "B.S. Computer Science", institution: "State University", year: "2018" }],
        generatedSummary: "Software engineer with four years of experience building backend systems in TypeScript.",
      };
      localStorage.setItem(enabledKey, "1");
      localStorage.setItem(resumeKey, JSON.stringify({ data: resume, updatedAt: new Date().toISOString(), sourceLabel: "e2e-journey-synthetic" }));
    },
    [LOCAL_AI_ENABLED_KEY, LOCAL_AI_RESUME_KEY, location],
  );

const fitGate = (page: Page) => page.locator('[data-testid="signup-gate"][data-gate-reason="fit"]');

test("a returning guest with a résumé in this browser opens /jobs on their top 3 matches and the sign-in card, not the front door", { tag: ["@J-JOBS-54"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await withResume(page, "Toronto, Ontario, Canada");
  await page.goto("/jobs");
  await expect(page).toHaveURL(/[?&]sort=fit/, { timeout: 30_000 });
  await expect(fitGate(page)).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId("job-row")).toHaveCount(3);
  await expectPackWindow(page);
  // A résumé is on file: no upload band, and not the front door's week count.
  await expect(page.locator(RESUME_BAND)).toHaveCount(0);
  await expect(page.getByTestId("front-door-week-count")).toHaveCount(0);
  expect(diagnostics.serverErrors).toEqual([]);
});

test("a guest with no résumé who opens a fit link gets the front door, and the fit sort leaves the URL", { tag: ["@J-JOBS-58"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await page.goto("/jobs?view=search&sort=fit");
  await expectFrontDoor(page, 30_000);
  await expect(page).not.toHaveURL(/[?&]sort=fit/);
  await expect(page.getByTestId("signup-gate")).toHaveCount(0);
  expect(diagnostics.serverErrors).toEqual([]);
});

signedInTest("a signed-in user who skipped the résumé card lands on Search with no job rows and the résumé band, with no sign-in line", { tag: ["@J-JOBS-55"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await page.goto("/jobs");
  await expectFrontDoor(page, 30_000);
  const band = page.locator(RESUME_BAND);
  await expect(band.getByRole("button", { name: "Upload résumé" })).toBeVisible();
  // Already signed in: no "Sign in to sync" line and no "free account" pitch.
  await expect(band.getByRole("button", { name: /^sign in$/i })).toHaveCount(0);
  await expect(band).not.toContainText(/free account/i);
  expect(diagnostics.serverErrors).toEqual([]);
});

signedInTest("a signed-in user with a résumé opens the Search tab on their résumé-ranked list, with no sign-in card", { tag: ["@J-JOBS-56"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  await withResume(page, "Toronto, Ontario, Canada");
  await page.goto("/jobs?view=search");
  await expect(page).toHaveURL(/[?&]sort=fit/, { timeout: 30_000 });
  await expectPackWindow(page);
  // More than a guest's top 3, and no gate between them.
  await expect.poll(() => page.getByTestId("job-row").count(), { timeout: 45_000 }).toBeGreaterThan(3);
  await expect(page.getByTestId("signup-gate")).toHaveCount(0);
  await expect(page.getByTestId("front-door-week-count")).toHaveCount(0);
  expect(diagnostics.serverErrors).toEqual([]);
});

test("on a phone, a guest with a résumé who goes back to Jobs gets 'See roles that fit your résumé', which reopens their matches", { tag: ["@J-JOBS-57"] }, async ({ page, diagnostics }) => {
  // Guests have a Jobs link only in the phone tab bar; on a wide screen there is no way back to rest.
  test.skip((page.viewportSize()?.width ?? 0) >= 1024, "guests have a Jobs link only in the phone tab bar");
  await returningVisitor(page);
  await withResume(page, "Toronto, Ontario, Canada");
  await page.goto("/jobs");
  await expect(fitGate(page)).toBeVisible({ timeout: 45_000 });

  // The tab bar's Jobs link: same page, so the résumé list isn't forced open a second time.
  // A DOM click, since the dev server's overlay badge sits over the tab bar's corner.
  await page.locator('a[href="/jobs"]:visible').first().evaluate((a: HTMLAnchorElement) => a.click());
  await expect(page).toHaveURL(/\/jobs$/, { timeout: 15_000 });
  const matches = page.getByTestId("front-door-matches");
  await expect(matches).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("job-row")).toHaveCount(0);

  await matches.click();
  await expect(page).toHaveURL(/[?&]sort=fit/, { timeout: 30_000 });
  await expect(fitGate(page)).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId("job-row")).toHaveCount(3);
  expect(diagnostics.serverErrors).toEqual([]);
});

/** Fabricated nurse (no real person), for the health packs. */
const withNurseResume = (page: Page, location: string) =>
  page.addInitScript(
    ([enabledKey, resumeKey, location]) => {
      const resume = {
        profile: { name: "Priya Sample", profession: "Registered Nurse", yearsOfExperience: 6, location, email: "priya.sample@example.com", phone: "555-010-3456", linkedin: "", website: "" },
        experience: [{ id: "exp1", company: "Lakeview Health Sciences Centre", role: "Registered Nurse, ICU", dates: "2021 - Present", description: "Bedside care for critically ill patients; triage; medication administration; charting in Epic." }],
        competencies: [{ category: "Clinical Skills", skills: ["Patient assessment", "Medication administration", "IV therapy", "BLS", "ACLS"] }],
        education: [{ id: "edu1", degree: "Bachelor of Science in Nursing", institution: "State University", year: "2019" }],
        generatedSummary: "Registered Nurse with six years of acute care experience in ICU and medical-surgical units.",
      };
      localStorage.setItem(enabledKey, "1");
      localStorage.setItem(resumeKey, JSON.stringify({ data: resume, updatedAt: new Date().toISOString(), sourceLabel: "e2e-journey-synthetic" }));
    },
    [LOCAL_AI_ENABLED_KEY, LOCAL_AI_RESUME_KEY, location],
  );

/**
 * The pack chips once every count has settled: a résumé visitor's hub hides the tiles
 * that hold under 3 roles or nearly all of them (industry-tiles.ts), so which chips a
 * journey can open is only known then. "1-Click tailored apply" never shows for a
 * résumé, so its chip means the résumé's tiles haven't replaced the browse ones yet.
 */
async function settledHubTiles(page: Page): Promise<string[]> {
  await expect(page.getByTestId("hub-pack-chips")).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          if (document.querySelector('[data-testid="hub-pack-card-apply"]')) return false;
          const counts = [...document.querySelectorAll('[data-testid^="hub-pack-count-"]')];
          return counts.length > 0 && counts.every((el) => !el.textContent?.includes("…") && el.getAttribute("data-matching") !== "true");
        }),
      { timeout: 90_000, message: "every pack chip count settled" },
    )
    .toBe(true);
  return page
    .locator('[data-testid="hub-pack-chips"] [data-testid^="hub-pack-card-"]')
    .evaluateAll((els) => els.map((el) => (el.getAttribute("data-testid") ?? "").replace("hub-pack-card-", "")));
}

/**
 * Open a packs-hub tile. The hub paints before it hydrates, and a tap that lands in that
 * gap does nothing, so tap again until the pack opens (its Back to Job Packs link shows).
 */
async function openHubTile(page: Page, id: string) {
  const card = page.getByTestId(`hub-pack-card-${id}`);
  const back = page.getByTestId("jobs-back-to-packs");
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(async () => {
    if (!(await back.isVisible())) await card.click({ timeout: 5_000 });
    await expect(back).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
}

signedInTest("a For-you pack opened from the hub, past the intro, has Edit filters on exactly the pack's filters, and a thin pack offers to broaden", { tag: ["@J-JOBS-27"] }, async ({ page, diagnostics }) => {
  // Iceland: a country with few software roles, so the pack is thin whatever the corpus holds today.
  await withResume(page, "Reykjavik, Iceland");
  await page.goto("/jobs?view=for-you");
  // For you opens on the packs hub; its first-visit intro must not block the pack controls once dismissed.
  await page.getByTestId("packs-home-intro-got-it").click({ timeout: 30_000 });
  await expect(page.getByTestId("packs-home-intro-modal")).toHaveCount(0);
  await openHubTile(page, "all");
  const edit = page.getByTestId("pack-edit-filters");
  await expect(edit).toBeVisible({ timeout: 30_000 });
  const href = new URL((await edit.getAttribute("href"))!, "http://x");
  expect(href.pathname).toBe("/jobs");
  expect(href.searchParams.get("country")).toBe("Iceland");
  expect(href.searchParams.get("view")).toBe("search");

  // Thin pack: the shared broaden nudge, with a count on every option it draws.
  const broaden = page.getByTestId("broaden-options");
  await expect(broaden).toBeVisible({ timeout: 30_000 });
  await expect(broaden.getByRole("link").first()).toContainText(/\d[\d,]* roles/);

  // Edit filters lands on the search board carrying the pack's country facet.
  await edit.click();
  await expect(page).toHaveURL(/[?&]country=Iceland/);
  await expect(page.getByTestId("for-you-home")).toHaveCount(0);
  expect(diagnostics.serverErrors).toEqual([]);
});

test("a board search with zero results offers to broaden, each option with its count", { tag: ["@J-JOBS-28"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await page.goto("/jobs?view=search&q=engineer&country=Iceland&exp=entry&posted=1d");
  const broaden = page.getByTestId("broaden-options");
  await expect(broaden).toBeVisible({ timeout: 30_000 });
  await expect(broaden.getByRole("button").first()).toContainText(/\d[\d,]* roles/);
  await broaden.getByRole("button").first().click();
  await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 30_000 });
  expect(diagnostics.serverErrors).toEqual([]);
});

signedInTest("a For-you pack in a country with no roles says so, never listing roles from elsewhere", { tag: ["@J-JOBS-37"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  // Tuvalu: a country with no roles for this pack. With none there at all the search drops the
  // place, and the pack used to list the whole corpus (or the visitor's own country) as its
  // matches. With a few there, none of them the pack's, it showed the generic "No ranked roles
  // to show right now." instead of naming the place.
  await withResume(page, "Funafuti, Tuvalu");
  await page.goto("/jobs?view=for-you");
  await openHubTile(page, "all");

  const none = page.getByTestId("for-you-no-roles-there");
  await expect(none).toBeVisible({ timeout: 30_000 });
  await expect(none).toContainText(/No (matching )?roles in Tuvalu yet\./);
  await expect(page.getByTestId("for-you-deck")).toHaveCount(0);
  // The pack counts 0 there, so the broaden options offer the way out, each with its count.
  const broaden = page.getByTestId("broaden-options");
  await expect(broaden).toBeVisible({ timeout: 30_000 });
  await expect(broaden.getByRole("link").first()).toContainText(/\d[\d,]* roles/);
  expect(diagnostics.serverErrors).toEqual([]);
});

signedInTest("a pack tile opens the pack with the tile's own filter, and the next tile does not inherit it", { tag: ["@J-JOBS-38"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  await withResume(page, "Toronto, Ontario, Canada");
  await page.goto("/jobs?view=for-you");
  const editHref = async () => {
    const edit = page.getByTestId("pack-edit-filters");
    await expect(edit).toBeVisible({ timeout: 30_000 });
    return new URL((await edit.getAttribute("href"))!, "http://x").searchParams;
  };

  // Fully remote: the pack (its country) with the remote work type on top.
  await openHubTile(page, "remote");
  const remote = await editHref();
  expect(remote.get("country")).toBe("Canada");
  expect((remote.get("work") ?? "").split(",")).toContain("remote");

  // Back on the hub, Added this week: the 7-day window, and no remote filter carried over.
  await page.getByTestId("jobs-back-to-packs").click();
  await page.getByTestId("hub-pack-card-fresh").click({ timeout: 30_000 });
  await expect.poll(async () => (await editHref()).get("posted"), { timeout: 30_000 }).toBe("7d");
  expect(((await editHref()).get("work") ?? "").split(",")).not.toContain("remote");
  expect(diagnostics.serverErrors).toEqual([]);
});

signedInTest("an opened pack tile lists only its own roles, from the first row it shows", { tag: ["@J-JOBS-39"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  await withResume(page, "Toronto, Ontario, Canada");
  await page.goto("/jobs?view=for-you");
  const cards = page.locator('[data-testid="for-you-deck"] [data-testid="role-stack-card"]');
  const places = page.locator('[data-testid="for-you-deck"] [data-testid="role-card-place"]');
  const frontPlace = page.locator('[data-testid="role-stack-card"][data-stack-pose="front"] [data-testid="role-card-place"]');

  // Fully remote: the deck used to show the hub's own rows (onsite, anywhere) until the
  // tile's search landed. Every role it shows, from the first, is a remote role: the cards
  // on the stack before and after the search settles, then each role Next brings up.
  await openHubTile(page, "remote");
  await expect(cards.first()).toBeVisible({ timeout: 60_000 });
  const firstPaint = await places.allInnerTexts();
  expect(firstPaint.length).toBeGreaterThan(0);
  for (const text of firstPaint) expect(text).toMatch(/\bRemote\b/);
  await page.waitForTimeout(3_000);
  for (const text of await places.allInnerTexts()) expect(text).toMatch(/\bRemote\b/);
  const next = page.getByTestId("for-you-next");
  for (let step = 0; step < 4 && (await next.isEnabled()); step++) {
    await next.click();
    await expect(frontPlace).toHaveText(/\bRemote\b/);
  }

  // A row tile (AI roles) counted on the hub opens on those roles: it used to keep only the
  // AI roles among the pack's top 3, usually none.
  // A row tile only shows when it holds 3 or more roles, so the one shown lists them.
  await page.getByTestId("jobs-back-to-packs").click();
  const shown = await settledHubTiles(page);
  const rowTile = ["ai", "lead", "good"].find((id) => shown.includes(id));
  expect(rowTile, `a row tile among ${shown.join(", ")}`).toBeTruthy();
  await page.getByTestId(`hub-pack-card-${rowTile}`).click({ timeout: 30_000 });
  await expect(cards.first()).toBeVisible({ timeout: 60_000 });
  expect(diagnostics.serverErrors).toEqual([]);
});

signedInTest("going back to the packs hub keeps the tile counts it had, without counting again", { tag: ["@J-JOBS-40"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  await withResume(page, "Toronto, Ontario, Canada");
  await page.goto("/jobs?view=for-you");
  // The filter tiles the hub shows (a tile holding nearly every role is hidden), each with its own count.
  const shown = await settledHubTiles(page);
  const tiles = ["remote", "fresh", "salary"].filter((id) => shown.includes(id));
  expect(tiles).toContain("remote");
  const count = (id: string) => page.getByTestId(`hub-pack-count-${id}`);
  const before = await Promise.all(tiles.map((id) => count(id).textContent()));

  // Each return used to re-run the hub's probe and every tile count: the counts blanked to
  // "…" for seconds, and a few tiles in, the visitor's search limit refused the next pack.
  await openHubTile(page, "remote");
  await expect(page.getByTestId("jobs-back-to-packs")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("jobs-back-to-packs").click();
  await expect(count("remote")).toBeVisible({ timeout: 30_000 });
  for (let sample = 0; sample < 15; sample++) {
    expect(await Promise.all(tiles.map((id) => count(id).textContent()))).toEqual(before);
    await page.waitForTimeout(100);
  }
  expect(diagnostics.serverErrors).toEqual([]);
});

signedInTest("with a résumé, the packs home opens on Today: the day's numbers and new matches above the pack tiles, and a skipped role stays gone after a reload", { tag: ["@J-JOBS-43"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  // Last here two days ago (seeded once, so the reload below is the same sitting and keeps that baseline).
  await page.addInitScript((key) => {
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, JSON.stringify({ lastSeenAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), since: null }));
  }, "intervu.today.visit");
  await withResume(page, "Toronto, Ontario, Canada");
  await page.goto("/jobs?view=for-you");

  const today = page.getByTestId("today-home");
  await expect(today).toBeVisible({ timeout: 30_000 });
  await expect(today.getByTestId("today-last-here")).toHaveText(/^Last here \w+/);
  // Above the tiles; the old welcome panel is one "Your packs" line that keeps Browse all matches.
  const tile = page.getByTestId("hub-pack-card-all");
  await expect(tile).toBeVisible({ timeout: 30_000 });
  expect((await today.boundingBox())!.y).toBeLessThan((await tile.boundingBox())!.y);
  await expect(page.getByTestId("hub-compact-header")).toBeVisible();
  await expect(page.getByTestId("hub-browse-all-matches")).toBeVisible();
  await expect(page.getByTestId("hub-daily-apply-tip")).toHaveCount(0);

  // The day's numbers, each a link: new since the last visit, applied today of the goal, follow-ups, interviews.
  const stats = today.getByTestId("today-stats");
  await expect(stats.getByTestId("today-stat-new")).toContainText(/new match(es)? since \w+/);
  await expect(stats.getByTestId("today-stat-applied")).toContainText("0 of 12");
  for (const id of ["today-stat-new", "today-stat-applied", "today-stat-follow-ups", "today-stat-interviews"]) {
    await expect(stats.getByTestId(id).getByRole("link")).toBeVisible();
  }

  // The list settles on rows or on one way on, never both. Signed in: up to TODAY_NEW_ROWS rows and "More in Added this week", no sign-in card.
  const rows = today.getByTestId("today-new-row");
  const empty = today.getByTestId("today-new-empty");
  await expect(rows.first().or(empty)).toBeVisible({ timeout: 60_000 });
  if (await empty.isVisible()) {
    await expect(rows).toHaveCount(0);
    await expect(empty.getByTestId("today-new-empty-action")).toHaveCount(1);
  } else {
    expect(await rows.count()).toBeLessThanOrEqual(TODAY_NEW_ROWS);
    for (const label of await rows.getByTestId("match-chip").allTextContents()) expect(label).toMatch(/^(Strong|Good)$/);
    await expect(rows.first().getByTestId("today-apply")).toBeVisible();
    await expect(today.getByTestId("today-see-more")).toHaveCount(1);
    await expect(today.getByTestId("signup-gate")).toHaveCount(0);

    const skippedId = (await rows.first().getAttribute("data-job-id"))!;
    const skipped = today.locator(`[data-testid="today-new-row"][data-job-id="${skippedId}"]`);
    await rows.first().getByTestId("today-skip").click();
    await expect(skipped).toHaveCount(0);
    await page.reload();
    await expect(rows.first().or(empty)).toBeVisible({ timeout: 60_000 });
    await expect(skipped).toHaveCount(0);
  }
  expect(withoutMockSignInHydration(diagnostics.pageErrors)).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

signedInTest("Needs you lists the tracker's interview this week and the application gone quiet, each opening that application", { tag: ["@J-JOBS-44"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  // A guest tracker: an interview tomorrow (a picked date is stored as its UTC midnight) and an application with no update for 10 days.
  await page.addInitScript((key) => {
    const now = new Date();
    const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000).toISOString();
    const tomorrow = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 1)).toISOString();
    const row = (id: string, company: string, position: string, status: string, updatedDaysAgo: number, extra = {}) => ({
      id,
      user_id: "guest",
      company_name: company,
      position,
      status,
      created_at: at(updatedDaysAgo + 3),
      updated_at: at(updatedDaysAgo),
      ...extra,
    });
    localStorage.setItem(
      key,
      JSON.stringify([
        row("journey-interview", "Northwind", "Platform Engineer", "interviewing", 2, { interview_date: tomorrow }),
        row("journey-quiet", "Contoso", "Backend Engineer", "applied", 10),
      ]),
    );
  }, "intervu.pursuits.guest");
  await withResume(page, "Toronto, Ontario, Canada");
  await page.goto("/jobs?view=for-you");

  const today = page.getByTestId("today-home");
  await expect(today).toBeVisible({ timeout: 30_000 });
  const needs = today.getByTestId("today-needs-you");
  await expect(needs).toBeVisible();

  // Soonest first: the interview, then the follow-up, each with one button into that application.
  const items = needs.getByTestId("today-needs-you-item");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toHaveAttribute("data-kind", "interview");
  await expect(items.nth(0)).toContainText("Interview tomorrow");
  await expect(items.nth(0).getByTestId("today-needs-you-action")).toHaveAttribute("href", "/yours/journey-interview");
  await expect(items.nth(1)).toHaveAttribute("data-kind", "follow_up");
  await expect(items.nth(1)).toContainText("Follow up with Contoso");
  await expect(items.nth(1)).toContainText("No update in 10 days");

  // The due and this-week numbers count the same rows and jump to the list.
  const stats = today.getByTestId("today-stats");
  await expect(stats.getByTestId("today-stat-follow-ups")).toContainText(/1\s*follow-up due/);
  await expect(stats.getByTestId("today-stat-interviews")).toContainText(/1\s*interview this week/);
  await stats.getByTestId("today-stat-follow-ups").getByRole("link").click();
  await expect(page).toHaveURL(/#today-needs-you$/);
  await expect(needs).toBeInViewport();

  await items.nth(1).getByTestId("today-needs-you-action").click();
  await expect(page).toHaveURL(/\/yours\/journey-quiet$/, { timeout: 30_000 });
  await expect(page.getByTestId("pursuit-stage")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Backend Engineer").first()).toBeVisible();
  expect(withoutMockSignInHydration(diagnostics.pageErrors)).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

signedInTest("the packs are one row of chips, and a chip says how many roles its pack gained since the last visit", { tag: ["@J-JOBS-47"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  await withResume(page, "Toronto, Ontario, Canada");
  await page.goto("/jobs?view=for-you");

  const chips = page.getByTestId("hub-pack-chips");
  await expect(chips).toBeVisible({ timeout: 30_000 });
  // All your matches, then at most six of the résumé's industry tiles (industry-tiles.ts).
  const shown = await settledHubTiles(page);
  expect(shown[0]).toBe("all");
  expect(shown.length).toBeLessThanOrEqual(7);

  // A first visit: once every count settles the device remembers them, and no chip claims a gain.
  const memoryKey = "velai.hub.tileCounts.v1";
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), memoryKey), { timeout: 90_000 }).not.toBeNull();
  await expect(page.locator('[data-testid^="hub-pack-delta-"]')).toHaveCount(0);

  // Make the last visit two days ago, with 3 fewer roles in each pack it counted exactly.
  const gained = await page.evaluate((key) => {
    const memory = JSON.parse(localStorage.getItem(key)!) as { counts: Record<string, number> };
    const ids = Object.keys(memory.counts).filter((id) => memory.counts[id] >= 3);
    const counts = Object.fromEntries(Object.entries(memory.counts).map(([id, n]) => [id, n >= 3 ? n - 3 : n]));
    localStorage.setItem(key, JSON.stringify({ ...memory, lastAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), counts, since: null }));
    return ids;
  }, memoryKey);
  expect(gained.length).toBeGreaterThan(0);

  await page.reload();
  for (const id of gained) {
    // At least the 3 taken away; a role posted in between can add to it.
    await expect(page.getByTestId(`hub-pack-delta-${id}`)).toHaveText(/^\+([3-9]|\d{2,})$/, { timeout: 90_000 });
    await expect(page.getByTestId(`hub-pack-card-${id}`)).toHaveAttribute("aria-label", /more since your last visit$/);
  }
  expect(diagnostics.serverErrors).toEqual([]);
});

signedInTest("a nurse's packs hub shows health tiles, never the tech ones, and each tile it shows opens on its own roles", { tag: ["@J-JOBS-48"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  await withNurseResume(page, "Toronto, Ontario, Canada");
  await page.goto("/jobs?view=for-you");

  // The hub used to give every résumé the same eight tiles: a nurse saw "Artificial
  // intelligence", "Tech for good" and "Lead & principal" (which counted Staff Nurse).
  const shown = await settledHubTiles(page);
  for (const tech of ["ai", "good", "lead", "apply"]) expect(shown, `no ${tech} tile for a nurse`).not.toContain(tech);
  const health = shown.filter((id) => id.startsWith("health_"));
  expect(health.length, `health tiles among ${shown.join(", ")}`).toBeGreaterThan(0);

  // A tile shows only when it holds at least 3 roles.
  const counts = await page
    .locator('[data-testid="hub-pack-chips"] [data-testid^="hub-pack-count-"]')
    .evaluateAll((els) => els.map((el) => [el.getAttribute("data-testid"), Number((el.textContent ?? "").replace(/[^\d]/g, "") || "0")] as const));
  for (const [id, n] of counts) if (id !== "hub-pack-count-all") expect(n, id ?? "").toBeGreaterThanOrEqual(3);

  const rows = page.locator('[data-testid="for-you-deck"] [data-testid="role-stack-card"]');
  await openHubTile(page, health[0]);
  await expect(rows.first()).toBeVisible({ timeout: 60_000 });
  expect(diagnostics.serverErrors).toEqual([]);
});

/**
 * Every Server Action POST answers 503, in the browser only; nothing reaches
 * the origin. Returns a switch that lets actions through again (the fixture's
 * analytics block stays in place, so no unroute).
 */
const failEveryAction = async (page: Page) => {
  let failing = true;
  await page.route("**/*", (route) =>
    failing && route.request().method() === "POST" && route.request().headers()["next-action"]
      ? route.fulfill({ status: 503, contentType: "text/plain", body: "journey stub: 503" })
      : route.fallback(),
  );
  return () => {
    failing = false;
  };
};

signedInTest("a failed ranked-list read shows an error with Retry, never the empty state", { tag: ["@J-JOBS-31"] }, async ({ page }) => {
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  await withResume(page, "Toronto, Ontario, Canada");
  const recover = await failEveryAction(page);
  await page.goto("/jobs?view=for-you");
  await openHubTile(page, "all");

  // One automatic retry (2-4 s) runs first, then the failure shows.
  const failed = page.getByTestId("for-you-load-failed");
  await expect(failed).toBeVisible({ timeout: 30_000 });
  await expect(failed).toHaveAttribute("role", "alert");
  await expect(page.getByTestId("for-you-empty")).toHaveCount(0);

  // Retry re-reads: with actions answering again, the error clears.
  recover();
  await page.getByTestId("for-you-load-failed-retry").click();
  await expect(failed).toHaveCount(0, { timeout: 30_000 });
});

signedInTest("a pack whose own read fails after another pack loaded shows the error with Retry, not a spinner or the other pack's roles", { tag: ["@J-JOBS-41"] }, async ({ page }) => {
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  await withResume(page, "Toronto, Ontario, Canada");
  await page.goto("/jobs?view=for-you");
  const rows = page.locator('[data-testid="for-you-deck"] [data-testid="role-stack-card"]');
  await openHubTile(page, "remote");
  await expect(rows.first()).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("jobs-back-to-packs").click();

  // The next pack's read fails. It used to wait on that read forever ("Loading your ranked
  // roles") because only a reported outage, not a thrown one, counted as settled.
  // Any other pack the hub shows will do; which ones show depends on the counts.
  const shown = await settledHubTiles(page);
  const next = ["salary", "fresh", ...shown].find((id) => id !== "all" && id !== "remote" && shown.includes(id));
  expect(next, `another pack among ${shown.join(", ")}`).toBeTruthy();
  const recover = await failEveryAction(page);
  await page.getByTestId(`hub-pack-card-${next}`).click({ timeout: 30_000 });
  const failed = page.getByTestId("for-you-load-failed");
  await expect(failed).toBeVisible({ timeout: 30_000 });
  await expect(rows).toHaveCount(0);

  recover();
  await page.getByTestId("for-you-load-failed-retry").click();
  await expect(failed).toHaveCount(0, { timeout: 30_000 });
  await expect(rows.first()).toBeVisible({ timeout: 60_000 });
});

signedInTest("an opened pack shows one role at a time as a stack, and Next, Previous and Skip move through it", { tag: ["@J-JOBS-50"] }, async ({ page, diagnostics }, testInfo) => {
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  await withResume(page, "Toronto, Ontario, Canada");
  await page.goto("/jobs?view=for-you");
  await openHubTile(page, "all");

  const stack = page.locator('[data-testid="for-you-deck"] [data-testid="role-stack"]');
  const front = stack.locator('[data-testid="role-stack-card"][data-stack-pose="front"]');
  const card = (id: string) => stack.locator(`[data-testid="role-stack-card"][data-job-id="${id}"]`);
  const frontId = async () => (await front.getAttribute("data-job-id")) ?? "";
  const position = page.getByTestId("for-you-deck-position");

  // One open role, in two parts: what we inferred about it on one side, what the posting states on the other.
  await expect(front).toHaveCount(1, { timeout: 60_000 });
  await expect(front.getByTestId("role-card-inferred")).toContainText("What we inferred");
  await expect(front.getByTestId("role-card-description")).toBeVisible();
  await expect(front.getByTestId("for-you-download-apply")).toBeVisible();
  await expect(position).toHaveText(/^Role 1 of \d+$/);
  const total = Number(/of (\d+)/.exec((await position.textContent()) ?? "")?.[1] ?? "0");
  test.skip(total < 3, "the pack needs three roles to step through");
  const first = await frontId();

  // Next brings the next role up in front; the one it covers tips back into the stack behind.
  await page.getByTestId("for-you-next").click();
  await expect(position).toHaveText(`Role 2 of ${total}`);
  await expect(card(first)).toHaveAttribute("data-stack-pose", "behind-1");
  const second = await frontId();
  expect(second).not.toBe(first);

  // Skip drops the open role: the next one takes its place and the count goes down by one.
  // Focus moves to the Skip of the role that came forward, so a keyboard user can keep going.
  await page.getByTestId("for-you-skip").click();
  await expect(position).toHaveText(`Role 2 of ${total - 1}`);
  await expect.poll(frontId).not.toBe(second);
  await expect(front.getByTestId("for-you-skip")).toBeFocused();
  await expect(card(second)).toHaveCount(0, { timeout: 5_000 });

  // Previous brings the first role back to the front.
  await page.getByTestId("for-you-previous").click();
  await expect(position).toHaveText(`Role 1 of ${total - 1}`);
  await expect.poll(frontId).toBe(first);
  await expect(page.getByTestId("for-you-previous")).toBeDisabled();

  // On a touch screen a sideways swipe inside the card changes role and never reaches the browser as Back.
  if (testInfo.project.use.hasTouch) {
    const url = page.url();
    const cdp = await page.context().newCDPSession(page);
    // The stage, not the card: the card may still be moving into place.
    const box = (await stack.boundingBox())!;
    const y = box.y + box.height * 0.4;
    const swipe = async (from: number, to: number) => {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + box.width * from, y }] });
      for (let i = 1; i <= 6; i++) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: box.x + box.width * (from + ((to - from) * i) / 6), y }] });
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    await swipe(0.8, 0.15);
    await expect(position).toHaveText(`Role 2 of ${total - 1}`);
    await swipe(0.15, 0.85);
    await expect(position).toHaveText(`Role 1 of ${total - 1}`);
    expect(page.url()).toBe(url);
  }
  expect(diagnostics.serverErrors).toEqual([]);
});

signedInTest("on a small phone an opened pack fits its card, actions and Next between the top bar and the tab bar", { tag: ["@J-JOBS-50"] }, async ({ page, diagnostics }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "the tab bar only shows on a phone-sized screen");
  await page.setViewportSize({ width: 360, height: 640 });
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  await withResume(page, "Toronto, Ontario, Canada");
  await page.goto("/jobs?view=for-you");
  await openHubTile(page, "all");

  const front = page.locator('[data-testid="for-you-deck"] [data-testid="role-stack-card"][data-stack-pose="front"]');
  await expect(front).toHaveCount(1, { timeout: 60_000 });
  const tabbarTop = async () => (await page.getByTestId("mobile-tabbar").boundingBox())?.y ?? 640;
  const bottom = async (testId: string) => {
    const box = await front.getByTestId(testId).boundingBox();
    return box ? box.y + box.height : Infinity;
  };
  // The page settles the stack into view on open: the card's actions clear the tab bar and Next stays under the top bar.
  // Again after going back to the packs and opening another one (its roles arrive in two batches).
  for (const round of ["first open", "second open"]) {
    if (round === "second open") {
      await page.getByTestId("for-you-next").click();
      await page.getByTestId("jobs-back-to-packs").click();
      // Whichever other pack the hub shows for this résumé (tiles with under 3 roles or nearly all of them are hidden).
      const shown = await settledHubTiles(page);
      const other = shown.find((id) => id !== "all");
      expect(other, `a second pack among ${shown.join(", ")}`).toBeTruthy();
      await openHubTile(page, other!);
      await expect(front).toHaveCount(1, { timeout: 60_000 });
    }
    await expect.poll(async () => (await bottom("for-you-skip")) <= (await tabbarTop()), { timeout: 10_000, message: round }).toBe(true);
    expect(await bottom("for-you-download-apply"), round).toBeLessThanOrEqual(await tabbarTop());
    const next = (await page.getByTestId("for-you-next").boundingBox())!;
    expect(next.y, round).toBeGreaterThanOrEqual(48);
  }
  expect(diagnostics.serverErrors).toEqual([]);
});

signedInTest("when every search fails, the packs home settles on saying so: Today shows the error with Retry and the chips drop their counts, never an endless \"…\"", { tag: ["@J-JOBS-51"] }, async ({ page }) => {
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  await withResume(page, "Toronto, Ontario, Canada");
  await failEveryAction(page);
  await page.goto("/jobs?view=for-you");

  // One automatic retry (2-4 s) runs first, then the failure shows.
  const failed = page.getByTestId("today-new-failed");
  await expect(failed).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("today-new-failed-retry")).toBeVisible();

  // The chips' counts come from the same refused searches. They used to read "…" for good.
  // A software engineer's chips: All, the tech tiles and the two shared ones, shown in full
  // while no count can say which to hide.
  const chips = page.getByTestId("hub-pack-chips");
  await expect(chips.getByRole("button")).toHaveCount(7);
  await expect(chips.locator('[data-testid^="hub-pack-count-"]')).toHaveCount(0, { timeout: 30_000 });
  await expect(chips).not.toContainText("…");
  await expect(page.getByTestId("hub-pack-card-all")).toHaveAttribute("aria-label", "All your matches");
});

/**
 * A pack's own search (it carries the pack's country) answers with what the server sends during a
 * search outage: no rows, `unavailable`, and the place reported as unmatched, because the place
 * check fails too. In the browser only; the action still runs, its answer is replaced. Returns a
 * switch that lets the real answers through again.
 */
const answerPackSearchAsOutage = async (page: Page, country: string) => {
  let failing = true;
  await page.route("**/*", async (route) => {
    const req = route.request();
    if (!failing || req.method() !== "POST" || !req.headers()["next-action"] || !(req.postData() ?? "").includes('"location_country"')) {
      return route.fallback();
    }
    const res = await route.fetch();
    // Row 0 is the action envelope (build id, "$@1"); row 1 carries the return value.
    const envelope = (await res.text()).split("\n")[0];
    const outage = { hits: [], total: 0, backend: "meilisearch", configured: true, unavailable: true, note: SEARCH_UNAVAILABLE_MESSAGE, searchId: "journey-outage", unmatchedPlaceMentions: [country] };
    return route.fulfill({ response: res, body: `${envelope}\n1:${JSON.stringify(outage)}\n` });
  });
  return () => {
    failing = false;
  };
};

signedInTest("a pack whose search is down shows the error with Retry, never 'No roles in <country>' or another list's roles", { tag: ["@J-JOBS-52"] }, async ({ page }) => {
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  await withResume(page, "Toronto, Ontario, Canada");
  const recover = await answerPackSearchAsOutage(page, "Canada");
  await page.goto("/jobs?view=for-you");
  await openHubTile(page, "all");
  const rows = page.locator('[data-testid="for-you-deck"] [data-testid="role-stack-card"]');

  // One automatic retry (2-4 s) runs first, then the failure shows. The outage answer names
  // Canada as unmatched; the pack used to say "No roles in Canada yet." instead of the error.
  const failed = page.getByTestId("for-you-load-failed");
  await expect(failed).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("for-you-no-roles-there")).toHaveCount(0);
  await expect(rows).toHaveCount(0);

  // Search is back: Retry lists the pack's own roles.
  recover();
  await page.getByTestId("for-you-load-failed-retry").click();
  await expect(failed).toHaveCount(0, { timeout: 30_000 });
  await expect(rows.first()).toBeVisible({ timeout: 60_000 });
});

/** Real reduplicated place names: the only strings the repeated-token check must not flag. */
const REDUPLICATED_PLACES = /\b(walla walla|bora bora|pago pago|wagga wagga)\b/gi;
const repeatedToken = (label: string) => label.replace(REDUPLICATED_PLACES, "").match(/\b(\w{3,})\s*\1\b/i)?.[0] ?? null;

test("no job card or job page location label repeats an adjacent token", { tag: ["@J-JOBS-26"] }, async ({ page, diagnostics }) => {
  // "remote" biases the result set toward the ATS "Remote Location" / "RemoteRemote" shapes.
  await searchFor(page, "remote");
  const locations = page.getByTestId("job-location");
  await expect(locations.first()).toBeVisible();
  const cardLabels = await locations.allTextContents();
  expect(cardLabels.length, "job cards rendered no location labels").toBeGreaterThan(0);
  expect(cardLabels.filter(repeatedToken), "card location labels with a repeated token").toEqual([]);

  const path = await page.getByTestId("job-row").first().locator('a[href^="/jobs/"]').first().getAttribute("href");
  await page.goto(path!);
  await expect(locations.first()).toBeVisible();
  const detailLabels = await locations.allTextContents();
  expect(detailLabels.filter(repeatedToken), "job page location labels with a repeated token").toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

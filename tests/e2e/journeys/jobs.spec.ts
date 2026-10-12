import type { Page } from "@playwright/test";
import { JOBS_VISITOR_COOKIE } from "../../../src/lib/jobs-visitor-cookie";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { PACKS_HOME_INTRO_KEY } from "../../../src/lib/jobs/for-you/packs-home-intro";
import { TODAY_PICK_ROWS, TODAY_PICKS_FETCH_LIMIT } from "../../../src/lib/jobs/for-you/today";
import { SEARCH_UNAVAILABLE_MESSAGE } from "../../../src/lib/jobs/result-state";
import { PACK_POSTED_BUCKET } from "../../../src/lib/jobs/url-state";
import { stripHtmlLikeIngest } from "../../fixtures/job-descriptions/ingest-strip";
import { EXPEL_TAM_HTML } from "../../fixtures/job-descriptions/postings";
import { expect, test } from "./fixtures";
import { runSearch } from "./search-box";
import { answerListSearch, isListSearch } from "./list-search";
import { signedInTest, withActionResult, withoutMockSignInHydration } from "./signed-in";

// Résumé kept in this browser: src/lib/local-ai/flag.ts + resume-storage.ts (same seeding tests/e2e/jobs-first-paint.spec.ts proves).
const LOCAL_AI_ENABLED_KEY = "velai.localAi.enabled";
const LOCAL_AI_RESUME_KEY = "velai.localAi.resume";

/** Journeys for the /jobs area — see tests/journeys/CATALOG.md (J-JOBS-01/23/24/25/26/27/31/37/38/39/40/41/43/44/46/47/48/50/51/52/54/55/56/57/58/60/61/94/95, J-SRCH-03, J-SRCH-21, J-DETAIL-01/43). Read-only. */

const returningVisitor = (page: Page) =>
  page.addInitScript((key) => localStorage.setItem(key, "1"), ONBOARDING_COMPLETED_STORAGE_KEY);

async function searchFor(page: Page, keyword: string) {
  await returningVisitor(page);
  await page.goto("/jobs");
  const input = page.getByPlaceholder("Job title, skill, or company");
  await input.fill(keyword);
  await runSearch(page, input);
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
 * The résumé-ranked list is a recommendation, so it keeps the packs' window (`PACK_POSTED_BUCKET`,
 * 30 days), not the typed-search default of 90 days.
 */
async function expectPackWindow(page: Page) {
  await expect(page).toHaveURL(new RegExp(`[?&]posted=${PACK_POSTED_BUCKET}\\b`));
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
 * with no résumé on file ranks this one. Seeded on every page load, or with `once` only on the
 * first, so a journey can remove it and reload.
 */
const withResume = (page: Page, location: string, { sourceLabel = "e2e-journey-synthetic", once = false } = {}) =>
  page.addInitScript(
    ([enabledKey, resumeKey, location, sourceLabel, once]) => {
      if (once && sessionStorage.getItem("e2e-guest-resume-seeded")) return;
      sessionStorage.setItem("e2e-guest-resume-seeded", "1");
      const resume = {
        profile: { name: "Sam Rivera", profession: "Software Engineer", yearsOfExperience: 4, location, email: "sam.rivera.dev@example.com", phone: "555-010-1234", linkedin: "", website: "" },
        experience: [{ id: "exp1", company: "Nimbus Data", role: "Software Engineer", dates: "2021 - Present", description: "Built backend services in TypeScript and Node." }],
        competencies: [{ category: "Languages", skills: ["TypeScript", "JavaScript", "Python", "SQL"] }],
        education: [{ id: "edu1", degree: "B.S. Computer Science", institution: "State University", year: "2018" }],
        generatedSummary: "Software engineer with four years of experience building backend systems in TypeScript.",
      };
      localStorage.setItem(enabledKey, "1");
      localStorage.setItem(resumeKey, JSON.stringify({ data: resume, updatedAt: new Date().toISOString(), sourceLabel }));
    },
    [LOCAL_AI_ENABLED_KEY, LOCAL_AI_RESUME_KEY, location, sourceLabel, once] as const,
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
  // Packs keep their own 30-day window, not the board's 90-day default (PACK_POSTED_BUCKET).
  expect(href.searchParams.get("posted")).toBe(PACK_POSTED_BUCKET);

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

signedInTest("with a résumé, the packs home runs welcome, pack chips, Today, tracker, history; Today has one summary line with the next step and this week's picks, each with its fit, Apply and thumbs up/down (thumbs on hover with a mouse)", { tag: ["@J-JOBS-43"] }, async ({ page, diagnostics }, testInfo) => {
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  // Last here two days ago (seeded once, so the reload below is the same sitting and keeps that baseline).
  await page.addInitScript((key) => {
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, JSON.stringify({ lastSeenAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), since: null }));
  }, "intervu.today.visit");
  await withResume(page, "Toronto, Ontario, Canada");
  await page.goto("/jobs?view=for-you");

  // The welcome panel: results are ranked in this browser, when they were last here, and which résumé
  // (the seed has no file name) with Replace. An account's résumé is managed on /resume, so no Remove
  // here (a guest's Remove is on Search, J-JOBS-61).
  const hub = page.getByTestId("job-packs-hub");
  await expect(hub.getByTestId("hub-private-matching")).toHaveText("Private matching active on this device", { timeout: 30_000 });
  await expect(hub.getByTestId("today-last-here")).toHaveText(/^Last here \w+/);
  const inUse = hub.getByTestId("today-resume-in-use");
  await expect(inUse).toContainText("Ranked against your résumé");
  await expect(inUse.getByTestId("today-replace-resume")).toBeVisible();
  await expect(inUse.getByTestId("today-remove-resume")).toHaveCount(0);
  await expect(page.getByTestId("hub-browse-all-matches")).toBeVisible();
  // Today counts applications against the daily goal, so the welcome panel's tip about it is gone.
  await expect(page.getByTestId("hub-daily-apply-tip")).toHaveCount(0);

  // The order Vivek asked for: the chips, then Today, then what they applied to, then history.
  const today = page.getByTestId("today-home");
  const chips = page.getByTestId("hub-pack-chips");
  await expect(today).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("hub-tracker")).toBeVisible({ timeout: 30_000 });
  const top = async (testId: string) => (await page.getByTestId(testId).boundingBox())!.y;
  expect(await top("hub-pack-chips")).toBeLessThan(await top("today-home"));
  expect(await top("today-home")).toBeLessThan(await top("hub-tracker"));
  expect(await top("hub-tracker")).toBeLessThan(await top("hub-recent"));
  await expect(chips).toBeVisible();
  // Today says what its picks are based on.
  await expect(today.getByTestId("today-basis")).toContainText("in your line of work, at your level, where you can work");

  // The day's numbers are one plain line, not a row of tiles ("too much happening here", Vivek 2026-10-01), each saying
  // what it counts, with the next thing to do; no daily goal ("0/12...so much confusion", Vivek 2026-10-07, J-JOBS-112).
  // Follow-ups and interviews are Needs you's rows.
  const summary = today.getByTestId("today-summary");
  await expect(today.getByTestId("today-stats")).toHaveCount(0);
  await expect(today).not.toContainText("of 12 applied");

  // The list settles on picks or on one way on, never both. Signed in: up to TODAY_PICK_ROWS picks, each Strong or Good
  // with Apply and the thumbs (a thumbs down is the way to drop one; there is no separate Skip); "All of this week"
  // opens the week's pack; no sign-in card.
  const rows = today.getByTestId("today-new-row");
  const empty = today.getByTestId("today-new-empty");
  await expect(rows.first().or(empty)).toBeVisible({ timeout: 60_000 });
  if (await empty.isVisible()) {
    await expect(rows).toHaveCount(0);
    await expect(empty.getByTestId("today-new-empty-action")).toHaveCount(1);
  } else {
    expect(await rows.count()).toBeLessThanOrEqual(TODAY_PICK_ROWS);
    await expect(summary.getByTestId("today-stat-new")).toHaveText(/^(No new roles fit you|\d+ new roles? fits? you) since \w+\.$/);
    await expect(summary.getByTestId("today-next-step")).toHaveText(/^Next: /);
    for (const label of await rows.getByTestId("match-chip").allTextContents()) expect(label).toMatch(/^(Strong|Good)$/);
    await expect(rows.first().getByTestId("today-apply")).toBeVisible();
    await expect(rows.first().getByTestId("role-more-like-this")).toBeVisible();
    await expect(rows.first().getByTestId("role-fewer-like-this")).toBeVisible();
    await expect(today.getByTestId("today-skip")).toHaveCount(0);
    // Apply, the next thing to do, always shows (Vivek 2026-10-07). With a mouse the thumbs wait for hover or keyboard
    // focus ("maybe some of these actions can be on hover", Vivek 2026-10-01); on touch there is no hover, so they show.
    const actions = rows.first().getByTestId("today-row-actions");
    const thumbs = rows.first().getByTestId("today-row-tuning");
    await page.mouse.move(0, 0);
    await expect(actions).toHaveCSS("opacity", "1");
    if (testInfo.project.use.hasTouch) {
      await expect(thumbs).toHaveCSS("opacity", "1");
    } else {
      await expect(thumbs).toHaveCSS("opacity", "0");
      await rows.first().hover();
      await expect(thumbs).toHaveCSS("opacity", "1");
      await page.mouse.move(0, 0);
      await expect(thumbs).toHaveCSS("opacity", "0");
      await rows.first().getByTestId("role-more-like-this").focus();
      await expect(thumbs).toHaveCSS("opacity", "1");
    }
    await expect(today.getByTestId("today-see-more")).toHaveText("All of this week");
    await expect(today.getByTestId("signup-gate")).toHaveCount(0);
  }
  expect(withoutMockSignInHydration(diagnostics.pageErrors)).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

signedInTest("a thumbs up or down on a Today pick tunes the list on this device: the tuning line names it, a thumbs down takes the pick out, the rating survives a reload, and Reset clears it", { tag: ["@J-JOBS-96"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  await withResume(page, "Toronto, Ontario, Canada");
  // A fixed week of roles in Canada, each sharing its company or its team with another, so a thumbs up or down always has a word to name.
  const inCanada = (id: string, title: string, company: string) => remoteRole(id, title, "Remote, Canada", { company });
  const week = [
    inCanada("tune-1", "Software Engineer", "Contoso"),
    inCanada("tune-2", "Software Engineer", "Fabrikam"),
    inCanada("tune-3", "Software Engineer, Payments", "Contoso"),
    inCanada("tune-4", "Software Engineer, Payments", "Fabrikam"),
  ];
  await page.route("**/api/jobs/search", async (route) => {
    const body = route.request().postDataJSON() as { limit?: number; postedSinceMs?: number };
    if (body.limit !== TODAY_PICKS_FETCH_LIMIT || !body.postedSinceMs) return route.continue();
    return answerListSearch(route, { hits: week, total: week.length, backend: "meilisearch", configured: true, searchId: "e2e-today-tune" });
  });
  await page.goto("/jobs?view=for-you");

  const today = page.getByTestId("today-home");
  const rows = today.getByTestId("today-new-row");
  await expect(rows.first()).toBeVisible({ timeout: 60_000 });
  expect(await rows.count()).toBeGreaterThanOrEqual(2);
  const tuning = today.getByTestId("today-tuning");
  await expect(tuning).toHaveCount(0);

  // Thumbs up: the pick stays, its button reads pressed, and the line says what the list leans toward.
  const likedId = (await rows.nth(1).getAttribute("data-job-id"))!;
  const liked = today.locator(`[data-testid="today-new-row"][data-job-id="${likedId}"]`);
  await liked.getByTestId("role-more-like-this").click();
  await expect(liked.getByTestId("role-more-like-this")).toHaveAttribute("aria-pressed", "true");
  await expect(tuning).toContainText(/^Tuned toward .+\./);

  // Thumbs down: that pick leaves, and the line says what the list now leans away from.
  const downId = (await rows.first().getAttribute("data-job-id"))!;
  expect(downId).not.toBe(likedId);
  await rows.first().getByTestId("role-fewer-like-this").click();
  await expect(today.locator(`[data-testid="today-new-row"][data-job-id="${downId}"]`)).toHaveCount(0);
  await expect(tuning).toContainText("away from");

  // On this device: both ratings are still there after a reload.
  await page.reload();
  await expect(rows.first()).toBeVisible({ timeout: 60_000 });
  await expect(today.locator(`[data-testid="today-new-row"][data-job-id="${downId}"]`)).toHaveCount(0);
  await expect(liked.getByTestId("role-more-like-this")).toHaveAttribute("aria-pressed", "true");
  await expect(tuning).toContainText(/toward .+away from/);

  // Reset drops the tuning; the thumbed-down pick stays skipped.
  await today.getByTestId("today-tuning-reset").click();
  await expect(tuning).toHaveCount(0);
  await expect(liked.getByTestId("role-more-like-this")).toHaveAttribute("aria-pressed", "false");
  expect(withoutMockSignInHydration(diagnostics.pageErrors)).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

signedInTest("a role Today labels Strong or Good carries the same fit word on its own page", { tag: ["@J-JOBS-100"] }, async ({ page, diagnostics }) => {
  // Vivek, 2026-10-02: Expel's Technical Account Manager read Strong on Today and Stretch on its page, because the
  // page also scored the description's opening words, which list rows don't carry, and skipped saved preferences.
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  await withResume(page, "Toronto, Ontario, Canada");
  await page.goto("/jobs?view=for-you");

  const rows = page.getByTestId("today-home").getByTestId("today-new-row");
  await expect(rows.first()).toBeVisible({ timeout: 60_000 });
  const picks: { href: string; label: string }[] = [];
  for (const row of (await rows.all()).slice(0, 3)) {
    picks.push({
      href: (await row.getByTestId("today-role-title").getAttribute("href"))!,
      label: (await row.getByTestId("match-chip").textContent())!.trim(),
    });
  }
  expect(picks.length).toBeGreaterThanOrEqual(2);

  // The first from Today itself (same visit), the others as a fresh visit to the role's link.
  await rows.first().getByTestId("today-role-title").click();
  for (const [index, pick] of picks.entries()) {
    if (index > 0) await page.goto(pick.href);
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 30_000 }).toBe(pick.href);
    // The first chip is the one under the title (related roles further down carry their own).
    await expect(page.getByTestId("match-chip").first(), pick.href).toHaveText(pick.label, { timeout: 30_000 });
  }
  expect(withoutMockSignInHydration(diagnostics.pageErrors)).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

signedInTest("a role outside where the candidate can work names their country instead of a fit word, in the list, on its page and in the reason", { tag: ["@J-JOBS-103"] }, async ({ page, diagnostics }) => {
  // Vivek, 2026-10-03, in Toronto: Island's "Technical Account Manager - U.S. Federal" read Good on its page. It holds
  // for any country; here a résumé in Austin meets roles in Canada.
  await returningVisitor(page);
  await withResume(page, "Austin, Texas, United States");
  await page.goto("/jobs?view=search&q=software%20engineer&country=Canada");

  const rows = page.getByTestId("job-row");
  await expect(rows.first()).toBeVisible({ timeout: 60_000 });
  const outside = rows.filter({ has: page.getByTestId("match-chip").filter({ hasText: /^Outside US$/ }) });
  await expect(outside.first()).toBeVisible({ timeout: 30_000 });
  const href = (await outside.first().getByTestId("job-title").getAttribute("href"))!;
  expect(href).toMatch(/^\/jobs\//);

  await page.goto(href);
  // The first chip is the one under the title (related roles further down carry their own).
  const chip = page.getByTestId("match-chip").first();
  await expect(chip, href).toHaveText("Outside US", { timeout: 30_000 });
  // Hover on desktop; a phone has no hover, a tap opens the reason.
  const reason = page.getByTestId("match-reason").first();
  if (test.info().project.name === "mobile") {
    await chip.tap();
    await expect(reason).toBeVisible({ timeout: 10_000 });
  } else {
    await expect(async () => {
      await page.mouse.move(0, 0);
      await chip.hover();
      await expect(reason).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
  }
  await expect(reason).toContainText("outside the United States, where your résumé places you.");
  await expect(reason).toContainText("If you can work there, add it under Relocation in Settings");
  expect(withoutMockSignInHydration(diagnostics.pageErrors)).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

signedInTest("a signed-in search for a place filters the list and leaves the saved preferences alone, so it never becomes where the candidate can work", { tag: ["@J-SRCH-33"] }, async ({ page, diagnostics }) => {
  // Saved preferences set the candidate's location for every fit label (resolveCandidateSignals): a search
  // that wrote them made one search for "United States" read as living there (2026-10-02).
  const preferenceWrites: string[] = [];
  page.on("request", (request) => {
    const body = request.method() === "POST" && request.headers()["next-action"] ? (request.postData() ?? "") : "";
    if (/"search":\{"(query|location)"/.test(body)) preferenceWrites.push(body);
  });
  await page.goto("/jobs?view=search&q=engineer&country=United%20States");
  const input = page.locator(SEARCH_INPUT);
  await expect(input).toBeVisible({ timeout: 30_000 });
  await input.fill("software engineer");
  await input.press("Enter");
  await expect(page).toHaveURL(/[?&]q=software(\+|%20)engineer/, { timeout: 30_000 });
  await expect(page).toHaveURL(/[?&]country=United/);
  await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 45_000 });
  // Server actions run one at a time, so a write queued behind the page's own reads goes out late: let them drain.
  await page.waitForLoadState("networkidle");
  expect(preferenceWrites).toEqual([]);
  expect(withoutMockSignInHydration(diagnostics.pageErrors)).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

signedInTest("signed in without a résumé, the packs home still has Today under the chips: what needs them, and where the picks would be, a way to add a résumé", { tag: ["@J-JOBS-97"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  await page.goto("/jobs?view=for-you");

  const today = page.getByTestId("today-home");
  await expect(today).toBeVisible({ timeout: 30_000 });
  expect((await page.getByTestId("hub-pack-chips").boundingBox())!.y).toBeLessThan((await today.boundingBox())!.y);
  const prompt = today.getByTestId("today-no-resume");
  await expect(prompt).toBeVisible({ timeout: 30_000 });
  await expect(prompt).toHaveAttribute("data-reason", "missing");
  await expect(prompt).toContainText("Picks need your résumé");
  await expect(today.getByTestId("today-new-row")).toHaveCount(0);
  // No picks, so no picks count, next step or "All of this week"; with no applications, no line about them either.
  // "Needs you" stays.
  await expect(today.getByTestId("today-stat-new")).toHaveCount(0);
  await expect(today.getByTestId("today-next-step")).toHaveCount(0);
  await expect(today.getByTestId("today-see-more")).toHaveCount(0);
  await expect(today.getByTestId("today-stat-applied")).toHaveCount(0);
  await expect(today.getByTestId("today-needs-you")).toBeVisible();
  // The welcome panel names no résumé it doesn't have.
  await expect(page.getByTestId("today-resume-in-use")).toHaveCount(0);

  await prompt.getByTestId("today-add-resume").click();
  await expect(page.getByRole("dialog").filter({ hasText: "Rank jobs by your résumé" })).toBeVisible({ timeout: 15_000 });
  expect(withoutMockSignInHydration(diagnostics.pageErrors)).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

signedInTest("Needs you lists the tracker's interview this week and the application gone quiet, each opening that application, and counts them; the tracker's numbers link to their stage", { tag: ["@J-JOBS-44"] }, async ({ page, diagnostics }) => {
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

  // The list's header counts them; Today has no separate follow-up or interview numbers.
  await expect(needs.getByTestId("today-needs-you-count")).toHaveText("2 to do");

  // Your tracker's numbers are tiles that open that stage on /yours; a zero opens nothing.
  const tracker = page.getByTestId("hub-tracker-stats");
  await expect(tracker.getByTestId("hub-tracker-stat-applied").getByRole("link")).toHaveAttribute("href", "/yours?stage=applied");
  await expect(tracker.getByTestId("hub-tracker-stat-interviewing").getByRole("link")).toHaveAttribute("href", "/yours?stage=interviewing");
  await expect(tracker.getByTestId("hub-tracker-stat-offer")).toContainText("0");
  await expect(tracker.getByTestId("hub-tracker-stat-offer").getByRole("link")).toHaveCount(0);

  await items.nth(1).getByTestId("today-needs-you-action").click();
  await expect(page).toHaveURL(/\/yours\/journey-quiet$/, { timeout: 30_000 });
  await expect(page.getByTestId("pursuit-stage")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Backend Engineer").first()).toBeVisible();
  expect(withoutMockSignInHydration(diagnostics.pageErrors)).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

signedInTest("Needs you asks for the account's side again by itself when the first read fails, and shows Retry only when the second fails too", { tag: ["@J-JOBS-113"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  await withResume(page, "Toronto, Ontario, Canada");

  // Vivek 2026-10-07: "We can't check your saved searches right now." on his hub, from one failed read with no retry.
  // The account read (`listNeedsYouAction`; its one argument carries `sinceIso`) fails `failures` times, then answers
  // with a saved search that has new roles.
  const remote = {
    searches: [{ id: "journey-search", name: "Nurse jobs in Toronto", href: "/jobs?q=nurse", count: 3, more: false }],
    follows: [],
    closedJobIds: [],
    savedSearchCount: 1,
    followCount: 0,
  };
  let failures = 1;
  let reads = 0;
  await page.route(
    () => true,
    async (route) => {
      const req = route.request();
      if (req.method() !== "POST" || !req.headers()["next-action"] || !(req.postData() ?? "").includes("sinceIso")) return route.fallback();
      reads += 1;
      const failed = reads <= failures;
      // A read still in flight when the test ends finds the page closed: nothing is left to answer.
      const res = await route.fetch().catch(() => null);
      if (!res) return;
      const text = await res.text();
      return route.fulfill({ response: res, body: withActionResult(text, failed ? { error: "Failed to load" } : { data: remote }) });
    },
  );
  await page.goto("/jobs?view=for-you");

  // One failed read: the second answers, and the panel never says it failed.
  const needs = page.getByTestId("today-home").getByTestId("today-needs-you");
  await expect(needs.getByTestId("today-needs-you-item").filter({ hasText: "has 3 new" })).toBeVisible({ timeout: 30_000 });
  expect(reads).toBe(2);
  await expect(needs.getByTestId("today-needs-you-failed")).toHaveCount(0);

  // Two failed reads: then it says so, and Retry asks again.
  failures = 2;
  reads = 0;
  await page.reload();
  await expect(needs.getByTestId("today-needs-you-failed")).toContainText("We can't check your saved searches right now.", { timeout: 30_000 });
  expect(reads).toBe(2);
  await needs.getByTestId("today-needs-you-failed-retry").click();
  await expect(needs.getByTestId("today-needs-you-item").filter({ hasText: "has 3 new" })).toBeVisible({ timeout: 30_000 });
  expect(reads).toBe(3);
  expect(withoutMockSignInHydration(diagnostics.pageErrors)).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

signedInTest("three or more applications gone quiet are one Needs you line that opens the Applied stage, under the interview", { tag: ["@J-JOBS-98"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  // A guest tracker: an interview tomorrow and four applications with no update for 8 to 11 days.
  await page.addInitScript((key) => {
    const now = new Date();
    const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000).toISOString();
    const tomorrow = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 1)).toISOString();
    const row = (id: string, company: string, status: string, updatedDaysAgo: number, extra = {}) => ({
      id,
      user_id: "guest",
      company_name: company,
      position: "Backend Engineer",
      status,
      created_at: at(updatedDaysAgo + 3),
      updated_at: at(updatedDaysAgo),
      ...extra,
    });
    localStorage.setItem(
      key,
      JSON.stringify([
        row("journey-interview", "Northwind", "interviewing", 2, { interview_date: tomorrow }),
        row("journey-quiet-1", "Contoso", "applied", 11),
        row("journey-quiet-2", "Fabrikam", "applied", 10),
        row("journey-quiet-3", "Tailspin", "applied", 9),
        row("journey-quiet-4", "Litware", "applied", 8),
      ]),
    );
  }, "intervu.pursuits.guest");
  await withResume(page, "Toronto, Ontario, Canada");
  await page.goto("/jobs?view=for-you");

  const needs = page.getByTestId("today-home").getByTestId("today-needs-you");
  await expect(needs).toBeVisible({ timeout: 30_000 });
  // One line per thing to do: the interview, then the four quiet applications as one line, not four.
  const items = needs.getByTestId("today-needs-you-item");
  await expect(items).toHaveCount(2);
  await expect(needs.getByTestId("today-needs-you-count")).toHaveText("2 to do");
  await expect(items.nth(0)).toContainText("Interview tomorrow");
  await expect(items.nth(1)).toHaveAttribute("data-kind", "follow_up");
  await expect(items.nth(1)).toContainText("Follow up on 4 applications");
  await expect(items.nth(1)).toContainText("No update in 8 to 11 days · Contoso, Fabrikam and 2 more");

  const review = items.nth(1).getByTestId("today-needs-you-action");
  await expect(review).toHaveText("Review");
  await expect(review).toHaveAttribute("href", "/yours?stage=applied");
  await review.click();
  await expect(page).toHaveURL(/\/yours\?stage=applied$/, { timeout: 30_000 });
  const board = page.getByTestId("tracker-kanban");
  await expect(board).toHaveAttribute("data-stage", "applied", { timeout: 30_000 });
  await expect(board.getByRole("region", { name: "Applied" })).toContainText("Contoso");
  expect(withoutMockSignInHydration(diagnostics.pageErrors)).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

signedInTest("Today says how many it applied to today and how many applications wait in Applied, and the waiting count opens that stage showing as many", { tag: ["@J-JOBS-109"] }, async ({ page, diagnostics }) => {
  // Vivek, 2026-10-06: "clicking the 0 of 12 applied open a tracker with 11 jobs already applied...what is happening".
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  // A guest tracker: one application today, two from earlier days, one interview.
  await page.addInitScript((key) => {
    const at = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();
    const row = (id: string, company: string, status: string, appliedDaysAgo: number) => ({
      id, user_id: "guest", company_name: company, position: "Backend Engineer", status,
      created_at: at(appliedDaysAgo + 1), updated_at: at(appliedDaysAgo), applied_at: at(appliedDaysAgo),
    });
    localStorage.setItem(key, JSON.stringify([
      row("applied-today", "Contoso", "applied", 0),
      row("applied-earlier-1", "Fabrikam", "applied", 2),
      row("applied-earlier-2", "Tailspin", "applied", 3),
      row("interviewing", "Northwind", "interviewing", 5),
    ]));
  }, "intervu.pursuits.guest");
  await withResume(page, "Toronto, Ontario, Canada");
  await page.goto("/jobs?view=for-you");

  const applied = page.getByTestId("today-home").getByTestId("today-stat-applied");
  await expect(applied).toHaveText("3 applications are waiting on a reply", { timeout: 30_000 });
  await expect(page.getByTestId("today-home").getByTestId("today-stat-applied-today")).toHaveText("You applied to 1 role today.");
  await applied.click();
  await expect(page).toHaveURL(/\/yours\?stage=applied$/, { timeout: 30_000 });
  const lane = page.getByTestId("tracker-kanban").getByRole("region", { name: "Applied" });
  await expect(lane.getByRole("heading")).toHaveText(/^Applied\s*3$/, { timeout: 30_000 });
  expect(withoutMockSignInHydration(diagnostics.pageErrors)).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

signedInTest("with nothing new since the last visit, Today says so, names the next step for the role it still lists, and counts the applications waiting in Applied instead of a daily goal", { tag: ["@J-JOBS-112"] }, async ({ page, diagnostics }, testInfo) => {
  // Vivek, 2026-10-07: "0/12, 0 picks...but 11 applied...and 1 role to look at....so much confusion...the UI needs to
  // almost nidge the user to do the next natural thing".
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  await page.addInitScript(() => {
    if (localStorage.getItem("intervu.today.visit")) return;
    localStorage.setItem("intervu.today.visit", JSON.stringify({ lastSeenAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), since: null }));
    localStorage.setItem("intervu.today.seen", JSON.stringify(["listed-before"]));
  });
  // Three applications from earlier days, none today.
  await page.addInitScript((key) => {
    const at = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();
    const row = (id: string, company: string, appliedDaysAgo: number) => ({
      id, user_id: "guest", company_name: company, position: "Backend Engineer", status: "applied",
      created_at: at(appliedDaysAgo + 1), updated_at: at(appliedDaysAgo), applied_at: at(appliedDaysAgo),
    });
    localStorage.setItem(key, JSON.stringify([row("a1", "Contoso", 2), row("a2", "Fabrikam", 3), row("a3", "Tailspin", 4)]));
  }, "intervu.pursuits.guest");
  await withResume(page, "Toronto, Ontario, Canada");
  const week = [remoteRole("listed-before", "Software Engineer", "Remote, Canada")];
  await page.route("**/api/jobs/search", async (route) => {
    const body = route.request().postDataJSON() as { limit?: number; postedSinceMs?: number };
    if (body.limit !== TODAY_PICKS_FETCH_LIMIT || !body.postedSinceMs) return route.continue();
    return answerListSearch(route, { hits: week, total: week.length, backend: "meilisearch", configured: true, searchId: "e2e-today-seen" });
  });
  await page.goto("/jobs?view=for-you");

  const today = page.getByTestId("today-home");
  const rows = today.getByTestId("today-new-row");
  await expect(rows).toHaveCount(1, { timeout: 60_000 });
  await expect(today.getByTestId("today-stat-new")).toHaveText(/^No new roles fit you since \w+\.$/);
  await expect(today.getByTestId("today-next-step")).toHaveText("Next: Apply to the role below, or give it a thumbs down so it stops showing.");
  await expect(today.getByTestId("today-stat-applied")).toHaveText("3 applications are waiting on a reply", { timeout: 30_000 });
  await expect(today.getByTestId("today-stat-applied")).toHaveAttribute("href", "/yours?stage=applied");
  await expect(today.getByTestId("today-stat-applied-today")).toHaveCount(0);
  await expect(today).not.toContainText("of 12");
  // The row's next action shows without a hover.
  if (!testInfo.project.use.hasTouch) await page.mouse.move(0, 0);
  await expect(rows.first().getByTestId("today-apply")).toBeVisible();
  await expect(rows.first().getByTestId("today-row-actions")).toHaveCSS("opacity", "1");
  expect(withoutMockSignInHydration(diagnostics.pageErrors)).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

/** A remote role for the Toronto software résumé: its own kind of role at its level, placed only as `location` says. */
const remoteRole = (id: string, title: string, location: string, extra: Record<string, unknown> = {}) => ({
  id, title, company: `Company ${id}`, company_domain: null, location, location_city: null, location_state: null, location_country: null,
  work_type: "remote", employment_type: "full_time", experience_level: "mid", salary_min: null, salary_max: null, salary_currency: null,
  salary_period: null, visa_sponsorship: null, tags: ["typescript"], apply_url: "https://example.com/apply", source: "e2e",
  posted_at: new Date().toISOString(), first_seen_at: null, updated_at: null, vacancy_status: "open", ghost_badge: null, ...extra,
});

signedInTest("Today leaves out roles for people in another country, whether the title, the place or the description says so", { tag: ["@J-JOBS-99"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  await withResume(page, "Toronto, Ontario, Canada");

  // This week's roles for the Toronto résumé, remote, written the ways postings write a place
  // (Vivek 2026-10-02: "I am in Canada and being referred India jobs").
  const role = remoteRole;
  const week = [
    role("in-canada", "Software Engineer", "Remote, Canada"),
    role("title-india", "Software Engineer (India)", "Remote"),
    role("place-us-only", "Software Engineer", "Remote (US only)"),
    role("desc-india", "Software Engineer, Platform", "Remote"),
    role("open-anywhere", "Software Engineer II", "Remote"),
    role("says-nothing", "Software Engineer, Tools", "Remote"),
  ];
  await page.route("**/api/jobs/search", async (route) => {
    const body = route.request().postDataJSON() as { limit?: number; postedSinceMs?: number };
    if (body.limit !== TODAY_PICKS_FETCH_LIMIT || !body.postedSinceMs) return route.continue();
    return answerListSearch(route, { hits: week, total: week.length, backend: "meilisearch", configured: true, searchId: "e2e-today" });
  });
  // Only rows with no place of their own are read for what their description says; the server reads "must be based in India"
  // for one and "hire anywhere" for another. A "Remote" role whose description names nowhere is not a pick: no evidence it's open to Canada.
  const asked: string[][] = [];
  await page.route("**/api/jobs/place-notes", async (route) => {
    asked.push((route.request().postDataJSON() as { ids: string[] }).ids);
    const notes = { "desc-india": { label: "India", countries: ["India"] }, "open-anywhere": { label: "anywhere", countries: [] }, "says-nothing": null };
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ notes }) });
  });
  await page.goto("/jobs?view=for-you");

  const today = page.getByTestId("today-home");
  const rows = today.getByTestId("today-new-row");
  await expect(rows.first()).toBeVisible({ timeout: 60_000 });
  expect(new Set(await rows.evaluateAll((els) => els.map((el) => el.getAttribute("data-job-id"))))).toEqual(new Set(["in-canada", "open-anywhere"]));
  expect(asked).toHaveLength(1);
  expect(new Set(asked[0])).toEqual(new Set(["desc-india", "open-anywhere", "says-nothing"]));

  // The route itself answers a malformed ask with 400 and an unknown id with no note.
  expect((await page.request.post("/api/jobs/place-notes", { data: { ids: [] } })).status()).toBe(400);
  expect(withoutMockSignInHydration(diagnostics.pageErrors)).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

signedInTest("Today leaves out a US-only role for a résumé in Canada when its title says U.S. Federal or it names no place and pays in USD", { tag: ["@J-JOBS-102"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  await withResume(page, "Toronto, Ontario, Canada");

  // Vivek 2026-10-03, in Canada: "Technical Account Manager - U.S. Federal" (Remote) and a Remote TAM role paying USD 114k-166k were Good Today picks.
  const pay = (currency: string) => ({ salary_min: 114_000, salary_max: 166_000, salary_currency: currency, salary_period: "year" });
  const week = [
    remoteRole("us-federal", "Software Engineer - U.S. Federal", "Remote"),
    remoteRole("pays-usd", "Software Engineer", "Remote", pay("USD")),
    remoteRole("pays-cad", "Software Engineer II", "Remote", pay("CAD")),
    remoteRole("usd-anywhere", "Software Engineer, Platform", "Remote", pay("USD")),
    remoteRole("usd-in-canada", "Software Engineer, Payments", "Remote, Canada", pay("USD")),
  ];
  await page.route("**/api/jobs/search", async (route) => {
    const body = route.request().postDataJSON() as { limit?: number; postedSinceMs?: number };
    if (body.limit !== TODAY_PICKS_FETCH_LIMIT || !body.postedSinceMs) return route.continue();
    return answerListSearch(route, { hits: week, total: week.length, backend: "meilisearch", configured: true, searchId: "e2e-today-pay" });
  });
  // The rows that name no place are read, the USD one too: its description may open it to anyone ("work from anywhere in the world").
  const asked: string[][] = [];
  await page.route("**/api/jobs/place-notes", async (route) => {
    asked.push((route.request().postDataJSON() as { ids: string[] }).ids);
    const notes = { "pays-usd": null, "pays-cad": null, "usd-anywhere": { label: "anywhere", countries: [] } };
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ notes }) });
  });
  await page.goto("/jobs?view=for-you");

  const rows = page.getByTestId("today-home").getByTestId("today-new-row");
  await expect(rows.first()).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => rows.evaluateAll((els) => els.map((el) => el.getAttribute("data-job-id")).sort())).toEqual(["pays-cad", "usd-anywhere", "usd-in-canada"]);
  expect(new Set(asked.flat())).toEqual(new Set(["pays-usd", "pays-cad", "usd-anywhere"]));
  expect(withoutMockSignInHydration(diagnostics.pageErrors)).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

signedInTest("Today picks a role only on evidence the candidate can take it: a bare-city Settings place, a wider country tag, a role that names nowhere", { tag: ["@J-JOBS-105"] }, async ({ page, diagnostics }) => {
  test.skip(Boolean(process.env.E2E_STORAGE_STATE), "reads its own saved Settings place, not a real account's");
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  await withResume(page, "Toronto, Ontario, Canada");

  // Vivek 2026-10-05, in Canada: Island's "Technical Account Manager - U.S. Federal" and "(NY/NJ)" (Remote) were Good Today picks again.
  // Settings › Location reads "Toronto", as a /jobs search used to save it: a city alone names no country, so the résumé's still counts.
  // The two zero-argument reads that refuse this browser as "Unauthorized" are the saved preferences and the account's email state;
  // one answer suits both.
  const saved = { configured: true, search: { location: "Toronto" }, answers: { custom: {} }, state: "reachable", email: null, pendingEmail: null };
  await page.route(
    () => true,
    async (route) => {
      const req = route.request();
      if (req.method() !== "POST" || !req.headers()["next-action"] || req.postData() !== "[]") return route.fallback();
      // A read still in flight when the test ends finds the page closed: nothing is left to answer.
      const res = await route.fetch().catch(() => null);
      if (!res) return;
      const text = await res.text();
      if (!text.includes('"Unauthorized"')) return route.fulfill({ response: res, body: text });
      return route.fulfill({ response: res, body: withActionResult(text, { data: saved }) });
    },
  );
  const northAmerica = { location_country: ["United States", "Canada"] };
  const week = [
    remoteRole("us-federal", "Software Engineer - U.S. Federal", "Remote", northAmerica),
    remoteRole("ny-nj", "Software Engineer (NY/NJ)", "Remote - North America"),
    remoteRole("us-only", "Software Engineer", "Remote (US only)"),
    remoteRole("canada-enterprise", "Software Engineer - Canada Enterprise", "Remote", northAmerica),
    remoteRole("in-canada", "Software Engineer II", "Remote, Canada"),
    // Tagged for both countries: its description says which ("must reside in the U.S."), or nothing, and the tag stands.
    remoteRole("wide-us", "Software Engineer, Platform", "Remote", northAmerica),
    remoteRole("wide-open", "Software Engineer, Data", "Remote", northAmerica),
    // "Remote" and nothing else says where it hires: no evidence they can take it.
    remoteRole("nowhere", "Software Engineer III", "Remote"),
  ];
  await page.route("**/api/jobs/search", async (route) => {
    const body = route.request().postDataJSON() as { limit?: number; postedSinceMs?: number };
    if (body.limit !== TODAY_PICKS_FETCH_LIMIT || !body.postedSinceMs) return route.continue();
    return answerListSearch(route, { hits: week, total: week.length, backend: "meilisearch", configured: true, searchId: "e2e-today-territory" });
  });
  const asked: string[][] = [];
  await page.route("**/api/jobs/place-notes", async (route) => {
    asked.push((route.request().postDataJSON() as { ids: string[] }).ids);
    const notes = { "wide-us": { label: "United States", countries: ["United States"] }, "wide-open": null, nowhere: null };
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ notes }) });
  });
  await page.goto("/jobs?view=for-you");

  const rows = page.getByTestId("today-home").getByTestId("today-new-row");
  await expect(rows.first()).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => rows.evaluateAll((els) => els.map((el) => el.getAttribute("data-job-id")).sort())).toEqual(["canada-enterprise", "in-canada", "wide-open"]);
  expect(new Set(asked.flat())).toEqual(new Set(["wide-us", "wide-open", "nowhere"]));
  for (const id of ["canada-enterprise", "in-canada", "wide-open"]) {
    await expect(rows.and(page.locator(`[data-job-id="${id}"]`)).getByTestId("match-chip").first()).not.toHaveText(/Outside/);
  }
  await expect(page.getByTestId("today-where-unknown")).toHaveCount(0);
  expect(withoutMockSignInHydration(diagnostics.pageErrors)).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

signedInTest("Today asks where the candidate can work when neither the résumé nor Settings names a country, and shows only roles open to anyone", { tag: ["@J-JOBS-106"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  await withResume(page, "");

  const week = [
    remoteRole("in-canada", "Software Engineer", "Remote, Canada"),
    remoteRole("us-only", "Software Engineer II", "Remote (US only)"),
    remoteRole("nowhere", "Software Engineer III", "Remote"),
    remoteRole("open-anywhere", "Software Engineer, Platform", "Remote"),
  ];
  await page.route("**/api/jobs/search", async (route) => {
    const body = route.request().postDataJSON() as { limit?: number; postedSinceMs?: number };
    if (body.limit !== TODAY_PICKS_FETCH_LIMIT || !body.postedSinceMs) return route.continue();
    return answerListSearch(route, { hits: week, total: week.length, backend: "meilisearch", configured: true, searchId: "e2e-today-nowhere" });
  });
  await page.route("**/api/jobs/place-notes", async (route) => {
    const notes = { nowhere: null, "open-anywhere": { label: "anywhere", countries: [] } };
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ notes }) });
  });
  await page.goto("/jobs?view=for-you");

  const ask = page.getByTestId("today-where-unknown");
  await expect(ask).toBeVisible({ timeout: 60_000 });
  await expect(ask.getByTestId("today-where-unknown-action")).toHaveAttribute("href", "/settings?tab=prefs");
  const rows = page.getByTestId("today-home").getByTestId("today-new-row");
  await expect.poll(() => rows.evaluateAll((els) => els.map((el) => el.getAttribute("data-job-id")))).toEqual(["open-anywhere"]);
  expect(withoutMockSignInHydration(diagnostics.pageErrors)).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

signedInTest("a role that doesn't say which countries it hires in reads Country unclear in the list, not a fit word, and its reason says why", { tag: ["@J-JOBS-107"] }, async ({ page, diagnostics }) => {
  // Vivek, 2026-10-05, in Canada: "Remote" roles that turned out to be US-only read Good. With no evidence either way the label says so.
  await returningVisitor(page);
  await withResume(page, "Toronto, Ontario, Canada");
  const hits = [
    remoteRole("in-canada", "Software Engineer", "Remote, Canada"),
    remoteRole("nowhere", "Software Engineer III", "Remote"),
  ];
  await page.route("**/api/jobs/search", (route) => answerListSearch(route, { hits, total: hits.length, backend: "meilisearch", configured: true, searchId: "e2e-unclear" }));
  await page.goto("/jobs?view=search&q=software%20engineer");

  const rows = page.getByTestId("job-row");
  const row = (title: string) => rows.filter({ has: page.getByTestId("job-title").getByText(title, { exact: true }) });
  await expect(row("Software Engineer III").getByTestId("match-chip")).toHaveText("Country unclear", { timeout: 60_000 });
  await expect(row("Software Engineer").getByTestId("match-chip")).toHaveText(/^(Strong|Good|Stretch)$/);

  const chip = row("Software Engineer III").getByTestId("match-chip");
  const reason = page.getByTestId("match-reason").first();
  if (test.info().project.name === "mobile") {
    await chip.tap();
    await expect(reason).toBeVisible({ timeout: 10_000 });
  } else {
    await expect(async () => {
      await page.mouse.move(0, 0);
      await chip.hover();
      await expect(reason).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
  }
  await expect(reason).toContainText("It's remote but doesn't say which countries it hires in");
  await expect(reason).toContainText("Check where it hires before you apply.");
  expect(withoutMockSignInHydration(diagnostics.pageErrors)).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

/** A fabricated career changer in Toronto: 13 years in all, the last 5 as a Technical Account Manager after 8 in engineering. */
async function withCareerChangerTamResume(page: Page) {
  await page.addInitScript(([enabledKey, resumeKey]) => {
    const resume = {
      profile: { name: "Alex Morgan", profession: "Technical Account Manager", yearsOfExperience: 13, location: "Toronto, Ontario, Canada", email: "alex.morgan@example.com", phone: "", linkedin: "", website: "" },
      experience: [
        { id: "e1", company: "Northwind", role: "Technical Account Manager", dates: "September 2021 - Present", description: "Own enterprise accounts, SLAs, escalations and renewals." },
        { id: "e2", company: "Contoso", role: "Senior Software Engineer", dates: "February 2013 - April 2018", description: "Built backend services." },
      ],
      competencies: [{ category: "Account management", skills: ["Enterprise SaaS", "SLA governance", "Escalations"] }],
      education: [{ id: "ed1", degree: "B.Tech", institution: "State University", year: "2012" }],
      generatedSummary: "Technical Account Manager owning enterprise SaaS accounts.",
    };
    localStorage.setItem(enabledKey, "1");
    localStorage.setItem(resumeKey, JSON.stringify({ data: resume, updatedAt: new Date().toISOString(), sourceLabel: "e2e-journey-synthetic" }));
  }, [LOCAL_AI_ENABLED_KEY, LOCAL_AI_RESUME_KEY] as const);
}

signedInTest("Today reads a career changer's level from the years in the role they hold now, so senior roles in that role aren't picks, whether the listing or only the title says senior", { tag: ["@J-JOBS-110"] }, async ({ page, diagnostics }) => {
  // Vivek, 2026-10-06: "All the roles that are showing up are all senior roles ... ALL MY RECOMMENDATIONS SUCK".
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  await withCareerChangerTamResume(page);
  const week = [
    remoteRole("tam", "Technical Account Manager", "Remote, Canada", { tags: [] }),
    remoteRole("tam-senior", "Senior Technical Account Manager", "Remote, Canada", { tags: [], experience_level: "senior" }),
    remoteRole("tam-senior-title", "Senior Technical Account Manager, Enterprise", "Remote, Canada", { tags: [], experience_level: "unknown" }),
  ];
  const asked: string[] = [];
  await page.route("**/api/jobs/search", async (route) => {
    const body = route.request().postDataJSON() as { limit?: number; postedSinceMs?: number };
    if (body.limit !== TODAY_PICKS_FETCH_LIMIT || !body.postedSinceMs) return route.continue();
    asked.push(JSON.stringify(body));
    return answerListSearch(route, { hits: week, total: week.length, backend: "meilisearch", configured: true, searchId: "e2e-today-level" });
  });
  await page.goto("/jobs?view=for-you");

  const rows = page.getByTestId("today-home").getByTestId("today-new-row");
  await expect(rows.first()).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => rows.evaluateAll((els) => els.map((el) => el.getAttribute("data-job-id")))).toEqual(["tam"]);
  // Today asks search for roles at their level, not senior ones too.
  expect(asked.at(-1)).toMatch(/\bmid\b/);
  expect(asked.at(-1)).not.toMatch(/\bsenior\b/i);
  expect(withoutMockSignInHydration(diagnostics.pageErrors)).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

signedInTest("a role above the candidate's level reads Stretch and ranks after the roles at their level, whether its title runs a team or it asks for more years, and its reason says which", { tag: ["@J-JOBS-116"] }, async ({ page, diagnostics }) => {
  // Vivek, 2026-10-11, on Sophos's "Manager, Customer Success (Enterprise)" (5+ years managing a team, 7+ as a CSM):
  // "why are these kinds of postings being recommended for me????? this is such a weak match". It read Good for a mid-level TAM.
  await returningVisitor(page);
  await withCareerChangerTamResume(page);
  const hits = [
    remoteRole("cs-manager", "Manager, Customer Success (Enterprise)", "Remote, Canada", { tags: [] }),
    remoteRole("tam-7y", "Technical Account Manager", "Remote, Canada", { tags: [], min_years_experience: 7 }),
    remoteRole("csm", "Customer Success Manager", "Remote, Canada", { tags: [] }),
    remoteRole("tam", "Technical Account Manager", "Remote, Canada", { tags: [], min_years_experience: 5 }),
  ];
  await page.route("**/api/jobs/search", (route) => answerListSearch(route, { hits, total: hits.length, backend: "meilisearch", configured: true, searchId: "e2e-above-level" }));
  await page.goto("/jobs?view=search&q=customer%20success&sort=fit");

  const rows = page.getByTestId("job-row");
  await expect(rows).toHaveCount(4, { timeout: 60_000 });
  const chip = (id: string) => page.locator(`[data-testid="job-row"][data-job-id="${id}"]`).getByTestId("match-chip");
  await expect(chip("cs-manager")).toHaveText("Stretch", { timeout: 60_000 });
  await expect(chip("tam-7y")).toHaveText("Stretch");
  await expect(chip("tam")).toHaveText("Strong");
  await expect(chip("csm")).toHaveText(/^(Strong|Good)$/);
  // Own role first, then the same kind of role; inside each, the role at their level before the one above it.
  await expect.poll(() => rows.evaluateAll((els) => els.map((el) => el.getAttribute("data-job-id")))).toEqual(["tam", "tam-7y", "csm", "cs-manager"]);

  const reason = page.getByTestId("match-reason").first();
  if (test.info().project.name === "mobile") {
    await chip("cs-manager").tap();
    await expect(reason).toBeVisible({ timeout: 10_000 });
  } else {
    await expect(async () => {
      await page.mouse.move(0, 0);
      await chip("cs-manager").hover();
      await expect(reason).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
  }
  await expect(reason).toContainText("It's a Stretch because");
  await expect(reason).toContainText(/its title runs a team, which makes it a senior role, above the mid level of your \d+ years as a Technical Account Manager/);
  expect(withoutMockSignInHydration(diagnostics.pageErrors)).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

signedInTest("a role whose title manages people reads Stretch for a résumé that shows no one managed, at their level or not, and its reason says so", { tag: ["@J-JOBS-117"] }, async ({ page, diagnostics }) => {
  // Vivek, 2026-10-11: "i dont have any managerial experience...i think that should have been taken into account".
  // Leading the work ("Led the payments rewrite with four engineers") is not managing people.
  await returningVisitor(page);
  await page.addInitScript(([enabledKey, resumeKey]) => {
    const resume = {
      profile: { name: "Jordan Lee", profession: "Senior Software Engineer", yearsOfExperience: 10, location: "Toronto, Ontario, Canada", email: "jordan.lee@example.com", phone: "", linkedin: "", website: "" },
      experience: [
        { id: "e1", company: "Nimbus Data", role: "Senior Software Engineer", dates: "January 2019 - Present", description: "Built backend services in TypeScript and Node. Led the payments rewrite with four engineers." },
        { id: "e2", company: "Contoso", role: "Software Engineer", dates: "June 2015 - December 2018", description: "Built APIs in Python." },
      ],
      competencies: [{ category: "Languages", skills: ["TypeScript", "Node.js", "Python", "SQL"] }],
      education: [],
      generatedSummary: "Senior software engineer building backend systems.",
    };
    localStorage.setItem(enabledKey, "1");
    localStorage.setItem(resumeKey, JSON.stringify({ data: resume, updatedAt: new Date().toISOString(), sourceLabel: "e2e-journey-synthetic" }));
  }, [LOCAL_AI_ENABLED_KEY, LOCAL_AI_RESUME_KEY] as const);
  const hits = [
    remoteRole("manager", "Manager, Software Engineering", "Remote, Canada", { tags: [], experience_level: "senior" }),
    remoteRole("ic", "Senior Software Engineer", "Remote, Canada", { tags: [], experience_level: "senior" }),
  ];
  await page.route("**/api/jobs/search", (route) => answerListSearch(route, { hits, total: hits.length, backend: "meilisearch", configured: true, searchId: "e2e-new-to-managing" }));
  await page.goto("/jobs?view=search&q=software%20engineer&sort=fit");

  const rows = page.getByTestId("job-row");
  await expect(rows).toHaveCount(2, { timeout: 60_000 });
  const chip = (id: string) => page.locator(`[data-testid="job-row"][data-job-id="${id}"]`).getByTestId("match-chip");
  await expect(chip("ic")).toHaveText("Strong", { timeout: 60_000 });
  await expect(chip("manager")).toHaveText("Stretch");
  await expect.poll(() => rows.evaluateAll((els) => els.map((el) => el.getAttribute("data-job-id")))).toEqual(["ic", "manager"]);

  const reason = page.getByTestId("match-reason").first();
  if (test.info().project.name === "mobile") {
    await chip("manager").tap();
    await expect(reason).toBeVisible({ timeout: 10_000 });
  } else {
    await expect(async () => {
      await page.mouse.move(0, 0);
      await chip("manager").hover();
      await expect(reason).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
  }
  await expect(reason).toContainText("matches the senior level of your 10 years of experience");
  await expect(reason).toContainText("It's a Stretch because its title manages people, which no role on your résumé shows you doing.");
  expect(withoutMockSignInHydration(diagnostics.pageErrors)).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

signedInTest("a fit-ranked list opened again leads with roles this device hasn't shown before, inside the same fit, and a role's reason says what the résumé's level was read from", { tag: ["@J-JOBS-111"] }, async ({ page, diagnostics }) => {
  // Vivek, 2026-10-06: "I keep seeing the same fucking result" and "users should be able to trust our results with why those results were returned".
  await returningVisitor(page);
  await page.addInitScript(() => {
    if (sessionStorage.getItem("e2e-seen-seeded")) return;
    sessionStorage.setItem("e2e-seen-seeded", "1");
    localStorage.setItem("intervu.today.seen", JSON.stringify(["shown-before"]));
  });
  await withResume(page, "Toronto, Ontario, Canada");
  // Same title, place and level: the same fit. The one shown before is the newer, so by score and date alone it led.
  const hits = [
    remoteRole("shown-before", "Software Engineer", "Remote, Canada"),
    remoteRole("not-shown", "Software Engineer", "Remote, Canada", { company: "Company other", posted_at: new Date(Date.now() - 2 * 86_400_000).toISOString() }),
  ];
  await page.route("**/api/jobs/search", (route) => answerListSearch(route, { hits, total: hits.length, backend: "meilisearch", configured: true, searchId: "e2e-unseen-first" }));
  await page.goto("/jobs?view=search&q=software%20engineer&sort=fit");

  const rows = page.getByTestId("job-row");
  await expect(rows).toHaveCount(2, { timeout: 60_000 });
  await expect.poll(() => rows.evaluateAll((els) => els.map((el) => el.getAttribute("data-job-id")))).toEqual(["not-shown", "shown-before"]);
  // Both are now shown on this device.
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("intervu.today.seen") ?? "[]"))).toEqual(expect.arrayContaining(["shown-before", "not-shown"]));

  const chip = rows.first().getByTestId("match-chip");
  const reason = page.getByTestId("match-reason").first();
  if (test.info().project.name === "mobile") {
    await chip.tap();
    await expect(reason).toBeVisible({ timeout: 10_000 });
  } else {
    await expect(async () => {
      await page.mouse.move(0, 0);
      await chip.hover();
      await expect(reason).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
  }
  // The fabricated résumé: 4 years in all, as a software engineer.
  await expect(reason).toContainText("a mid-level role, which matches the mid level of your 4 years of experience");
  expect(withoutMockSignInHydration(diagnostics.pageErrors)).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

/** This week's picks for the Toronto résumé: one listed on an earlier visit, one that reached search after it but was posted before it. */
const weekOfTwo = async (page: Page) => {
  const week = [
    remoteRole("listed-before", "Software Engineer", "Remote, Canada"),
    remoteRole("reached-late", "Software Engineer II", "Remote, Canada", { posted_at: new Date(Date.now() - 3 * 86_400_000).toISOString() }),
  ];
  await page.route("**/api/jobs/search", async (route) => {
    const body = route.request().postDataJSON() as { limit?: number; postedSinceMs?: number };
    if (body.limit !== TODAY_PICKS_FETCH_LIMIT || !body.postedSinceMs) return route.continue();
    return answerListSearch(route, { hits: week, total: week.length, backend: "meilisearch", configured: true, searchId: "e2e-today-new" });
  });
};

signedInTest("Today counts a pick as new when this device hadn't listed it before, even when it was posted before the last visit and reached search after it", { tag: ["@J-JOBS-108"] }, async ({ page, diagnostics }) => {
  // Vivek, 2026-10-06: "0 new picks today" while new roles kept arriving. Roles reach search hours after their posting date.
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  await page.addInitScript(() => {
    if (localStorage.getItem("intervu.today.visit")) return;
    localStorage.setItem("intervu.today.visit", JSON.stringify({ lastSeenAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), since: null }));
    localStorage.setItem("intervu.today.seen", JSON.stringify(["listed-before"]));
  });
  await withResume(page, "Toronto, Ontario, Canada");
  await weekOfTwo(page);
  await page.goto("/jobs?view=for-you");

  const today = page.getByTestId("today-home");
  const rows = today.getByTestId("today-new-row");
  await expect(rows).toHaveCount(2, { timeout: 60_000 });
  await expect(today.getByTestId("today-stat-new")).toHaveText(/^1 new role fits you since \w+\.$/);
  await expect(today.getByTestId("today-next-step")).toHaveText("Next: It's at the top, marked New. Apply if it suits you.");
  await expect(rows.and(page.locator('[data-job-id="reached-late"]')).getByTestId("today-new-badge")).toHaveCount(1);
  await expect(rows.and(page.locator('[data-job-id="listed-before"]')).getByTestId("today-new-badge")).toHaveCount(0);
  expect(withoutMockSignInHydration(diagnostics.pageErrors)).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

signedInTest("on a first visit Today counts every pick as this week's and marks none New", { tag: ["@J-JOBS-108"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  await withResume(page, "Toronto, Ontario, Canada");
  await weekOfTwo(page);
  await page.goto("/jobs?view=for-you");

  const today = page.getByTestId("today-home");
  await expect(today.getByTestId("today-new-row")).toHaveCount(2, { timeout: 60_000 });
  await expect(today.getByTestId("today-stat-new")).toHaveText("2 roles posted this week fit you.");
  await expect(today.getByTestId("today-new-badge")).toHaveCount(0);
  expect(withoutMockSignInHydration(diagnostics.pageErrors)).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

signedInTest("Today pins the roles the last daily picks email named at the top, each marked Emailed, and offers the daily picks email as a switch", { tag: ["@J-JOBS-118"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  await withResume(page, "Toronto, Ontario, Canada");
  await weekOfTwo(page);
  // The account's daily picks: off, and an email from earlier today that named the older of the week's two roles.
  await page.route(
    () => true,
    async (route) => {
      const req = route.request();
      if (req.method() !== "POST" || !req.headers()["next-action"] || req.postData() !== "[]") return route.fallback();
      const res = await route.fetch().catch(() => null);
      if (!res) return;
      const text = await res.text();
      if (!text.includes("Sign in to get daily picks.") && !text.includes('"emailedIds"')) return route.fulfill({ response: res, body: text });
      return route.fulfill({
        response: res,
        body: withActionResult(text, { data: { on: false, reachable: true, blockedGlobally: false, emailedIds: ["reached-late"], resumeReady: null } }),
      });
    },
  );
  await page.goto("/jobs?view=for-you");

  const today = page.getByTestId("today-home");
  const rows = today.getByTestId("today-new-row");
  await expect(rows).toHaveCount(2, { timeout: 60_000 });
  await expect(rows.first()).toHaveAttribute("data-job-id", "reached-late");
  await expect(rows.first().getByTestId("today-emailed-badge")).toHaveText("Emailed");
  await expect(today.getByTestId("today-emailed-badge")).toHaveCount(1);
  const line = today.getByTestId("today-daily-picks");
  await expect(line).toContainText("Email me new picks each day");
  await expect(line.getByRole("switch", { name: "Email me new picks each day" })).toHaveAttribute("aria-checked", "false");
  expect(withoutMockSignInHydration(diagnostics.pageErrors)).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

signedInTest("an opened pack reads its roles' descriptions for place before it shows, so a role for people in another country is never its first card", { tag: ["@J-JOBS-101"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  await withResume(page, "Toronto, Ontario, Canada");
  // Every card the deck puts in front, in order, from its first paint on.
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __deckFronts: string[] }).__deckFronts = seen;
    new MutationObserver(() => {
      const id = document.querySelector('[data-testid="for-you-deck"] [data-testid="role-stack-card"][data-stack-pose="front"]')?.getAttribute("data-job-id");
      if (id && seen[seen.length - 1] !== id) seen.push(id);
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-stack-pose", "data-job-id"] });
  });

  // The pack's search lists a role whose description is for people in India first; its title and place say only "Remote".
  const pack = [
    remoteRole("desc-india", "Software Engineer", "Remote"),
    remoteRole("in-canada", "Software Engineer", "Remote, Canada"),
    remoteRole("open-anywhere", "Software Engineer", "Remote"),
  ];
  const ids = new Set(pack.map((p) => p.id));
  await page.route("**/*", async (route) => {
    const req = route.request();
    const body = req.postData() ?? "";
    if (!isListSearch(req) || !body.includes('"withFacets":true') || !body.includes('"offset":0')) return route.fallback();
    return answerListSearch(route, { hits: pack, total: pack.length, backend: "meilisearch", configured: true, searchId: "e2e-pack" });
  });
  // The read answers late, as a slow server would: the deck waits for it rather than showing the India role and moving it.
  const asked: string[][] = [];
  await page.route("**/api/jobs/place-notes", async (route) => {
    const wanted = (route.request().postDataJSON() as { ids: string[] }).ids;
    if (wanted.some((id) => ids.has(id))) asked.push(wanted);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const notes = Object.fromEntries(wanted.map((id) => [id, id === "desc-india" ? { label: "India", countries: ["India"] } : null]));
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ notes }) });
  });

  await page.goto("/jobs?view=for-you");
  await openHubTile(page, "all");
  const front = page.locator('[data-testid="for-you-deck"] [data-testid="role-stack-card"][data-stack-pose="front"]');
  await expect(front).toHaveCount(1, { timeout: 60_000 });
  await expect(page.getByTestId("for-you-deck-position")).toHaveText("Role 1 of 3");
  // Only the rows that name no place were read, once, and the India role was never in front until it was reached, last.
  expect(asked).toHaveLength(1);
  expect(new Set(asked[0])).toEqual(new Set(["desc-india", "open-anywhere"]));
  for (let step = 0; step < 2; step++) await page.getByTestId("for-you-next").click();
  await expect(front).toHaveAttribute("data-job-id", "desc-india");
  await expect(page.getByTestId("for-you-deck-position")).toHaveText("Role 3 of 3");
  const fronts = await page.evaluate(() => (window as unknown as { __deckFronts: string[] }).__deckFronts);
  expect(fronts.indexOf("desc-india")).toBe(fronts.length - 1);
  expect(fronts.slice(0, -1)).not.toContain("desc-india");
  // Never Strong: it is for people in India.
  await expect(front.getByTestId("match-chip").first()).not.toHaveText("Strong");
  expect(withoutMockSignInHydration(diagnostics.pageErrors)).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

signedInTest("an open role's \"What we inferred\" names the same posted date and level as its details: a role posted 21 days ago that we found this week isn't new", { tag: ["@J-JOBS-114"] }, async ({ page, diagnostics }) => {
  // Vivek, 2026-10-09: "posted within 7 days is marked green, but it was posted 21 days ago" and
  // "seniority says exceeds ask in one, whereas the other listing says it is ok" (the level named was his, not the role's).
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  await withResume(page, "Toronto, Ontario, Canada");
  const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  const pack = [
    remoteRole("found-late", "Software Engineer", "Remote, Canada", { posted_at: daysAgo(21), first_seen_at: daysAgo(3) }),
    remoteRole("senior-listed", "Senior Software Engineer", "Remote, Canada", { experience_level: "senior", posted_at: daysAgo(21), first_seen_at: daysAgo(20) }),
  ];
  await page.route("**/*", async (route) => {
    const req = route.request();
    const body = req.postData() ?? "";
    if (!isListSearch(req) || !body.includes('"withFacets":true') || !body.includes('"offset":0')) return route.fallback();
    return answerListSearch(route, { hits: pack, total: pack.length, backend: "meilisearch", configured: true, searchId: "e2e-inferred-agrees" });
  });

  await page.goto("/jobs?view=for-you");
  await openHubTile(page, "all");
  const front = page.locator('[data-testid="for-you-deck"] [data-testid="role-stack-card"][data-stack-pose="front"]');
  await expect(front).toHaveCount(1, { timeout: 60_000 });
  const detail = (label: string) => front.locator("dt", { hasText: new RegExp(`^${label}$`) }).locator("xpath=following-sibling::dd[1]");
  const inferred = front.getByTestId("role-card-inferred");
  const seen = new Set<string>();
  for (let step = 0; step < pack.length; step++) {
    if (step > 0) await page.getByTestId("for-you-next").click();
    const id = (await front.getAttribute("data-job-id")) ?? "";
    seen.add(id);
    await expect(detail("Posted")).toHaveText("21d ago");
    await expect(inferred).toContainText("Posted 21d ago");
    await expect(inferred).not.toContainText("within the last 7 days");
    // The résumé: 4 years as a software engineer, mid level. The row names the role's level as the details show it, then theirs.
    if (id === "found-late") {
      await expect(detail("Seniority")).toHaveText("Mid");
      await expect(inferred).toContainText("Seniority: mid-level role — matches your mid level (4 years of experience)");
    } else {
      await expect(detail("Seniority")).toHaveText("Senior");
      await expect(inferred).toContainText("Seniority: senior role — above your mid level (4 years of experience)");
    }
  }
  expect([...seen].sort()).toEqual(["found-late", "senior-listed"]);
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
  // A count is exact or at least 10+: never "0+" or "1+", which read as tiny exact numbers.
  for (const count of await page.locator('[data-testid^="hub-pack-count-"]').allTextContents()) {
    expect(count.trim()).not.toMatch(/^\d\+$/);
  }

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

test("a guest's Search names the résumé it ranks against, and Remove forgets it for good", { tag: ["@J-JOBS-61"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  // The upload's file name, as the importer stores it. Seeded once, so the reload below finds what Remove left.
  await withResume(page, "Toronto, Ontario, Canada", { sourceLabel: "Sam_Rivera_Resume_V4.pdf", once: true });
  await page.goto("/jobs");
  // For you needs an account, so a guest's résumé opens Search on their top 3.
  await expect(fitGate(page)).toBeVisible({ timeout: 45_000 });
  const inUse = page.getByTestId("resume-as-of");
  await expect(inUse).toContainText("Scoring with Sam_Rivera_Resume_V4.pdf");

  // Remove asks once; "Keep it" changes nothing.
  await inUse.getByTestId("jobs-remove-resume").click();
  await inUse.getByTestId("jobs-remove-resume-no").click();
  await expect(inUse).toContainText("Sam_Rivera_Resume_V4.pdf");

  await inUse.getByTestId("jobs-remove-resume").click();
  await inUse.getByTestId("jobs-remove-resume-yes").click();
  // Nothing is ranked against a résumé now: the front door, no rows, no fit sort.
  await expectFrontDoor(page, 30_000);
  await expect(page.getByTestId("resume-as-of")).toHaveCount(0);
  await expect(page).not.toHaveURL(/[?&]sort=fit/);
  expect(await page.evaluate((key) => localStorage.getItem(key), LOCAL_AI_RESUME_KEY)).toBeNull();

  // A reload doesn't bring it back.
  await page.goto("/jobs");
  await expectFrontDoor(page, 30_000);
  await expect(page.getByTestId("resume-as-of")).toHaveCount(0);
  expect(diagnostics.pageErrors).toEqual([]);
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
 * Every Server Action POST and every list search answers 503, in the browser
 * only; nothing reaches the origin. Returns a switch that lets them through
 * again (the fixture's analytics block stays in place, so no unroute).
 */
const failEveryAction = async (page: Page) => {
  let failing = true;
  await page.route("**/*", (route) =>
    failing && route.request().method() === "POST" && (route.request().headers()["next-action"] || isListSearch(route.request()))
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
  // Again after going back to the packs and opening another one (its roles arrive in two batches), and again
  // on reopening that pack: its roles are on screen at once, and the page kept the hub's scroll down at its
  // chips, clamped past the stack, until the fit learned to scroll back up.
  let other = "";
  for (const round of ["first open", "second open", "same pack again"]) {
    if (round !== "first open") {
      await page.getByTestId("for-you-next").click();
      await page.getByTestId("jobs-back-to-packs").click();
      if (round === "second open") {
        // Whichever other pack the hub shows for this résumé (tiles with under 3 roles or nearly all of them are hidden).
        const shown = await settledHubTiles(page);
        other = shown.find((id) => id !== "all") ?? "";
        expect(other, `a second pack among ${shown.join(", ")}`).toBeTruthy();
      }
      await openHubTile(page, other);
      await expect(front).toHaveCount(1, { timeout: 60_000 });
    }
    const nextTop = async () => (await page.getByTestId("for-you-next").boundingBox())?.y ?? -1;
    await expect
      .poll(async () => (await bottom("for-you-skip")) <= (await tabbarTop()) && (await nextTop()) >= 48, { timeout: 10_000, message: round })
      .toBe(true);
    expect(await bottom("for-you-download-apply"), round).toBeLessThanOrEqual(await tabbarTop());
  }
  expect(diagnostics.serverErrors).toEqual([]);
});

signedInTest("an opened pack's role card shows the posting in its own sections, word for word", { tag: ["@J-DETAIL-43"] }, async ({ page, diagnostics }) => {
  // The card used to sort a posting into fixed "What you'll do / What you bring / Nice to have / Perks"
  // boxes, dropping whatever fit none of them (the company, pay); it now shows the whole posting
  // laid out like the job pane (2026-10-01). Every role's text is served as the ingest-shaped Expel posting.
  await page.route("**/api/jobs/*/description", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    if (body?.hits?.[0]) body.hits[0].description = stripHtmlLikeIngest(EXPEL_TAM_HTML);
    await route.fulfill({ response, json: body });
  });
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  await withResume(page, "Toronto, Ontario, Canada");
  await page.goto("/jobs?view=for-you");
  await openHubTile(page, "all");

  const front = page.locator('[data-testid="for-you-deck"] [data-testid="role-stack-card"][data-stack-pose="front"]');
  const description = front.getByTestId("role-card-description");
  await expect(description.getByRole("heading")).toHaveText(["About Expel", "What you’ll do", "What you should bring with you", "Compensation"], { timeout: 60_000 });
  await expect(description.getByRole("list")).toHaveCount(2);
  await expect(description.getByText("The base salary range for this role is $150,000 - $180,000 USD, plus equity and benefits.")).toBeVisible();
  await expect(description.getByText("#LI-Remote")).toBeVisible();
  // The Summary is the posting's own first sentence.
  await expect(front.getByText("Summary", { exact: true })).toBeVisible();
  await expect(front.getByText(/^Expel is a security operations provider that helps organizations of all sizes minimize business risk\.$/)).toBeVisible();
  expect(withoutMockSignInHydration(diagnostics.pageErrors)).toEqual([]);
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
 * check fails too. In the browser only; the search still runs, its answer is replaced. Returns a
 * switch that lets the real answers through again.
 */
const answerPackSearchAsOutage = async (page: Page, country: string) => {
  let failing = true;
  await page.route("**/*", async (route) => {
    const req = route.request();
    if (!failing || !isListSearch(req) || !(req.postData() ?? "").includes('"location_country"')) {
      return route.fallback();
    }
    const outage = { hits: [], total: 0, backend: "meilisearch", configured: true, unavailable: true, note: SEARCH_UNAVAILABLE_MESSAGE, searchId: "journey-outage", unmatchedPlaceMentions: [country] };
    return answerListSearch(route, outage);
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

signedInTest("an opened pack's controls share one row under the top bar, and its role card starts right under them and fills the screen", { tag: ["@J-JOBS-80"] }, async ({ page, diagnostics }, testInfo) => {
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  await withResume(page, "Toronto, Ontario, Canada");
  await page.goto("/jobs?view=for-you");
  await openHubTile(page, "all");

  const header = page.getByTestId("for-you-pack-header");
  const front = page.locator('[data-testid="for-you-deck"] [data-testid="role-stack-card"][data-stack-pose="front"]');
  await expect(front).toHaveCount(1, { timeout: 60_000 });
  // The page settles the stack into view on open; measure once it has.
  await page.waitForTimeout(1_500);

  // One row: the way back, the pack's name, where you are in it, Edit filters and Previous/Next.
  // They used to stack as three rows (Back to Job Packs, Replace résumé, Edit filters) above the controls.
  await expect(header.getByRole("heading", { name: "All your matches" })).toBeVisible();
  for (const id of ["jobs-back-to-packs", "for-you-deck-position", "pack-edit-filters", "for-you-previous", "for-you-next"]) {
    await expect(header.getByTestId(id), id).toBeVisible();
  }
  await expect(page.getByTestId("jobs-back-to-packs")).toHaveCount(1);
  const head = (await header.boundingBox())!;
  expect(head.height, "the controls fit one row").toBeLessThanOrEqual(56);
  for (const id of ["jobs-back-to-packs", "pack-edit-filters", "for-you-next"]) {
    const box = (await header.getByTestId(id).boundingBox())!;
    const middle = box.y + box.height / 2;
    expect(middle, `${id} sits in the row`).toBeGreaterThan(head.y);
    expect(middle, `${id} sits in the row`).toBeLessThan(head.y + head.height);
  }

  // The card starts right under the row (or under a thin pack's broaden options) and runs to the
  // bottom of the screen, above the tab bar on a phone.
  const filters = page.getByTestId("for-you-pack-filters");
  const above = (await filters.isVisible()) ? (await filters.boundingBox())! : head;
  const card = (await front.boundingBox())!;
  expect(card.y - (above.y + above.height), "card starts under the controls").toBeLessThanOrEqual(64);
  const floor = testInfo.project.use.hasTouch
    ? ((await page.getByTestId("mobile-tabbar").boundingBox())?.y ?? page.viewportSize()!.height)
    : page.viewportSize()!.height;
  expect(card.y + card.height, "card ends on screen").toBeLessThanOrEqual(floor);
  expect(floor - (card.y + card.height), "card fills the screen").toBeLessThanOrEqual(48);

  // The row stays pinned under the top bar while the page scrolls.
  await page.evaluate(() => window.scrollBy(0, 400));
  await page.waitForTimeout(300);
  for (const id of ["jobs-back-to-packs", "for-you-deck-position", "for-you-next"]) {
    await expect(header.getByTestId(id), `${id} after scrolling`).toBeInViewport();
  }

  // The back arrow returns to the packs.
  await header.getByTestId("jobs-back-to-packs").click();
  await expect(page.getByTestId("hub-pack-chips")).toBeVisible({ timeout: 30_000 });
  expect(diagnostics.serverErrors).toEqual([]);
});

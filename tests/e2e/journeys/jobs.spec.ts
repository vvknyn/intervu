import type { Page, Request } from "@playwright/test";
import { gunzipSync } from "node:zlib";
import { JOBS_VISITOR_COOKIE } from "../../../src/lib/jobs-visitor-cookie";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { SEARCH_UNAVAILABLE_MESSAGE } from "../../../src/lib/jobs/result-state";
import { PACK_POSTED_BUCKET } from "../../../src/lib/jobs/url-state";
import { stripHtmlLikeIngest } from "../../fixtures/job-descriptions/ingest-strip";
import { EXPEL_TAM_HTML } from "../../fixtures/job-descriptions/postings";
import { expect, test } from "./fixtures";
import { runSearch } from "./search-box";
import { answerListSearch, isListSearch } from "./list-search";
import { signedInTest, withActionResult, withoutMockSignInHydration } from "./signed-in";

// Résumé kept in this browser: src/lib/local-ai/flag.ts + resume-storage.ts.
const LOCAL_AI_ENABLED_KEY = "velai.localAi.enabled";
const LOCAL_AI_RESUME_KEY = "velai.localAi.resume";

/** Journeys for the /jobs area — see tests/journeys/CATALOG.md (J-JOBS rows, J-SRCH-03/21/33/35/37, J-DETAIL-01/43). Read-only. */

// Route handlers still answering when a test ends must not fail it (as in personalized.spec.ts).
test.afterEach(({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));

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

  test(`${visitor.name} reads every data line on a row: company/place and the fit reason are never cut to one line`, { tag: ["@J-JOBS-01"] }, async ({ page, baseURL }) => {
    await openJobs(page, baseURL, visitor.previousSession, "/jobs?q=engineer");
    await expectBoard(page, 30_000);
    const meta = page.getByTestId("job-row-meta");
    await expect(meta.first()).toBeVisible();
    // Clamped to at most two lines (the full string is in `title`), never the old single-line ellipsis.
    const tooTall = await meta.evaluateAll((els) => els.filter((e) => e.clientHeight > 2 * parseFloat(getComputedStyle(e).lineHeight) + 1).length);
    expect(tooTall).toBe(0);
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

/**
 * An analytics request's body as text: posthog-js sends events gzipped
 * (`compression=gzip-js`) or base64 in a `data=` form field; the ledger sends JSON.
 */
function analyticsBody(req: Request): string {
  const raw = req.postDataBuffer();
  if (!raw) return "";
  const compression = new URL(req.url()).searchParams.get("compression");
  if (compression === "gzip-js") return gunzipSync(raw).toString("utf8");
  const text = raw.toString("utf8");
  if (compression === "base64" || text.startsWith("data=")) {
    const data = new URLSearchParams(text).get("data") ?? "";
    return Buffer.from(data, "base64").toString("utf8");
  }
  return text;
}

test("a search's words never reach analytics: events carry its shape, not what was typed", { tag: ["@J-SRCH-35"] }, async ({ page, diagnostics }) => {
  // A common query on purpose: every prod run lands in the anonymous search
  // log the demand view reads, and a made-up word would sit in "Nothing found".
  const word = "accountant";
  // The fixture aborts analytics; these page-level routes win, answer locally
  // and keep each body, so nothing reaches PostHog or the ledger.
  const ledgerEvents: string[] = [];
  const bodies: string[] = [];
  await page.route("**/api/telemetry", async (route) => {
    const body = analyticsBody(route.request());
    bodies.push(body);
    for (const e of (JSON.parse(body || "{}") as { events?: { event_name: string }[] }).events ?? []) ledgerEvents.push(e.event_name);
    await route.fulfill({ status: 204 });
  });
  // Event capture only: replay snapshots (/s/) and flag reads are not events.
  await page.route(
    (url) => /^\/ph\/(e|i\/v0\/e|batch)\/?$/.test(url.pathname),
    async (route) => {
      bodies.push(analyticsBody(route.request()));
      await route.fulfill({ status: 200, json: { status: 1 } });
    },
  );

  await searchFor(page, word);
  await expect(page).toHaveURL(new RegExp(`[?&]q=${word}`));
  await expect.poll(() => ledgerEvents, { timeout: 15_000 }).toContain("search_submitted").catch(() => {});
  test.skip(!ledgerEvents.includes("search_submitted"), "this build sends no analytics (no PostHog key), so there is nothing to check");

  const leaked = bodies.filter((body) => body.toLowerCase().includes(word));
  expect(leaked, "no analytics payload holds the words searched").toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
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
 * A guest keeps it in this browser; a signed-in account with no résumé on file ranks this one. Seeded on every page load, or with `once` only on the
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

/** A remote role for the Toronto software résumé: its own kind of role at its level, placed only as `location` says. */
const remoteRole = (id: string, title: string, location: string, extra: Record<string, unknown> = {}) => ({
  id, title, company: `Company ${id}`, company_domain: null, location, location_city: null, location_state: null, location_country: null,
  work_type: "remote", employment_type: "full_time", experience_level: "mid", salary_min: null, salary_max: null, salary_currency: null,
  salary_period: null, visa_sponsorship: null, tags: ["typescript"], apply_url: "https://example.com/apply", source: "e2e",
  posted_at: new Date().toISOString(), first_seen_at: null, updated_at: null, vacancy_status: "open", ghost_badge: null, ...extra,
});

/** Every list search answers with `hits`, in the browser only: the search still runs. */
const answerFitList = (page: Page, hits: object[], searchId: string, extra: Record<string, unknown> = {}) =>
  page.route("**/api/jobs/search", (route) =>
    answerListSearch(route, { hits, total: hits.length, backend: "meilisearch", configured: true, searchId, ...extra }),
  );

const listRowIds = (page: Page) => page.getByTestId("job-row").evaluateAll((els) => els.map((el) => el.getAttribute("data-job-id")));

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
  await page.goto("/jobs?sort=fit");
  await expectFrontDoor(page, 30_000);
  await expect(page).not.toHaveURL(/[?&]sort=fit/);
  await expect(page.getByTestId("signup-gate")).toHaveCount(0);
  expect(diagnostics.serverErrors).toEqual([]);
});

signedInTest("one page shape signed in: a résumé on file opens the list on the fit sort with no For you or Search toggle, no packs hub, and an old For you link opens the same list", { tag: ["@J-JOBS-158"] }, async ({ page, diagnostics }) => {
  // Vivek, 2026-10-21: "remove the entire For you dashboard ... just show the traditional list view but keep the resume matching".
  await returningVisitor(page);
  await withResume(page, "Toronto, Ontario, Canada");
  await answerFitList(page, [remoteRole("one-shape", "Software Engineer", "Remote, Canada")], "e2e-one-shape");
  for (const path of ["/jobs", "/jobs?view=for-you", "/jobs?view=search"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/[?&]sort=fit/, { timeout: 30_000 });
    await expect(page.getByTestId("job-row")).toHaveCount(1, { timeout: 60_000 });
    await expect(page.getByTestId("result-line")).toBeVisible();
    for (const id of ["for-you-home", "job-packs-hub", "jobs-home-for-you", "jobs-home-search", "today-home"]) await expect(page.getByTestId(id), `${path} ${id}`).toHaveCount(0);
    await expect(page.locator('[data-testid^="hub-pack-"]')).toHaveCount(0);
  }
  expect(withoutMockSignInHydration(diagnostics.pageErrors)).toEqual([]);
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
  await withResume(page, "Toronto, Ontario, Canada");
  await page.goto("/jobs");
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

test("a board search with zero results offers to broaden, each option with its count", { tag: ["@J-JOBS-28"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await page.goto("/jobs?q=engineer&country=Iceland&exp=entry&posted=1d");
  const broaden = page.getByTestId("broaden-options");
  await expect(broaden).toBeVisible({ timeout: 30_000 });
  await expect(broaden.getByRole("button").first()).toContainText(/\d[\d,]* roles/);
  await broaden.getByRole("button").first().click();
  await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 30_000 });
  expect(diagnostics.serverErrors).toEqual([]);
});

test("a résumé in a country with no roles says so, never listing roles from elsewhere", { tag: ["@J-JOBS-37"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  // Tuvalu: no roles there at all, so the search drops the place and answers with roles from elsewhere. The list used to
  // show them as the résumé's matches (an Iceland résumé once listed ~1M roles from other countries): the place is
  // an eligibility rule, so none there means none.
  await withResume(page, "Funafuti, Tuvalu");
  await answerFitList(
    page,
    [remoteRole("elsewhere-1", "Software Engineer", "Toronto, ON"), remoteRole("elsewhere-2", "Software Engineer II", "Austin, TX")],
    "e2e-no-roles-there",
    { total: 5000, unmatchedPlaceMentions: ["Tuvalu"] },
  );
  await page.goto("/jobs");

  const none = page.getByTestId("list-none-fit");
  await expect(none).toContainText("No roles in Tuvalu yet.", { timeout: 60_000 });
  await expect(page.getByTestId("job-row")).toHaveCount(0);
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

test("a role the list labels Strong or Good carries the same fit word on its own page", { tag: ["@J-JOBS-100"] }, async ({ page, diagnostics }) => {
  // Vivek, 2026-10-02: Expel's Technical Account Manager read Strong in the picks and Stretch on its page, because the
  // page also scored the description's opening words, which list rows don't carry, and skipped saved preferences.
  await returningVisitor(page);
  await withResume(page, "Toronto, Ontario, Canada");
  await page.goto("/jobs");

  const rows = page.getByTestId("job-row");
  await expect(rows.first()).toBeVisible({ timeout: 60_000 });
  const picks: { href: string; label: string }[] = [];
  for (const row of (await rows.all()).slice(0, 3)) {
    picks.push({
      href: (await row.getByTestId("job-title").getAttribute("href"))!,
      label: (await row.getByTestId("match-chip").textContent())!.trim(),
    });
  }
  expect(picks.length).toBeGreaterThanOrEqual(2);

  for (const pick of picks) {
    await page.goto(pick.href);
    // The first chip is the one under the title (related roles further down carry their own).
    await expect(page.getByTestId("match-chip").first(), pick.href).toHaveText(pick.label, { timeout: 30_000 });
  }
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

signedInTest("a role outside where the candidate can work names their country instead of a fit word, in the list, on its page and in the reason", { tag: ["@J-JOBS-103"] }, async ({ page, diagnostics }) => {
  // Vivek, 2026-10-03, in Toronto: Island's "Technical Account Manager - U.S. Federal" read Good on its page. It holds
  // for any country; here a résumé in Austin meets roles in Canada.
  await returningVisitor(page);
  await withResume(page, "Austin, Texas, United States");
  await page.goto("/jobs?q=software%20engineer&country=Canada");

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
  await page.goto("/jobs?q=engineer&country=United%20States");
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

test("the list leaves out roles for people in another country, whether the title, the place or the description says so", { tag: ["@J-JOBS-99"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await withResume(page, "Toronto, Ontario, Canada");

  // This week's roles for the Toronto résumé, remote, written the ways postings write a place
  // (Vivek 2026-10-02: "I am in Canada and being referred India jobs").
  const role = remoteRole;
  await answerFitList(
    page,
    [
      role("in-canada", "Software Engineer", "Remote, Canada"),
      role("title-india", "Software Engineer (India)", "Remote"),
      role("place-us-only", "Software Engineer", "Remote (US only)"),
      role("desc-india", "Software Engineer, Platform", "Remote"),
      role("open-anywhere", "Software Engineer II", "Remote"),
    ],
    "e2e-eligibility",
  );
  // Only rows with no place of their own are read for what their description says; the server reads "must be based in India"
  // for one and "hire anywhere" for another. The read answers late, as a slow server would.
  const asked = new Set<string>();
  await page.route("**/api/jobs/place-notes", async (route) => {
    for (const id of (route.request().postDataJSON() as { ids: string[] }).ids) asked.add(id);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const notes = { "desc-india": { label: "India", countries: ["India"] }, "open-anywhere": { label: "anywhere", countries: [] } };
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ notes }) });
  });
  await page.goto("/jobs");

  await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => listRowIds(page).then((ids) => ids.slice().sort()), { timeout: 30_000 }).toEqual(["in-canada", "open-anywhere"]);
  expect(asked.has("title-india") || asked.has("place-us-only"), "a role whose title or place already names a country is not read").toBe(false);
  expect(asked.has("desc-india")).toBe(true);
  await expect(page.getByTestId("list-left-out")).toContainText("outside where you can work");

  // The route itself answers a malformed ask with 400 and an unknown id with no note.
  expect((await page.request.post("/api/jobs/place-notes", { data: { ids: [] } })).status()).toBe(400);
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

test("the list leaves out a role titled U.S. Federal for a résumé in Canada and ranks a role that names no place and pays in USD after the roles open to Canada", { tag: ["@J-JOBS-102"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await withResume(page, "Toronto, Ontario, Canada");

  // Vivek 2026-10-03, in Canada: "Technical Account Manager - U.S. Federal" (Remote) and a Remote TAM role paying USD 114k-166k were Good picks.
  const pay = (currency: string) => ({ salary_min: 114_000, salary_max: 166_000, salary_currency: currency, salary_period: "year" });
  await answerFitList(
    page,
    [
      remoteRole("us-federal", "Software Engineer - U.S. Federal", "Remote"),
      remoteRole("pays-usd", "Software Engineer", "Remote", pay("USD")),
      remoteRole("pays-cad", "Software Engineer II", "Remote", pay("CAD")),
      remoteRole("usd-in-canada", "Software Engineer, Payments", "Remote, Canada", pay("USD")),
    ],
    "e2e-eligibility-pay",
  );
  // The rows that name no place are read for what their description says; this one's names nothing.
  const asked = new Set<string>();
  await page.route("**/api/jobs/place-notes", async (route) => {
    for (const id of (route.request().postDataJSON() as { ids: string[] }).ids) asked.add(id);
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ notes: { "pays-usd": null, "pays-cad": null } }) });
  });
  await page.goto("/jobs");

  await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 60_000 });
  // Never a pick: the title says U.S. Federal. Last, under a country label and not a fit word: no place, USD pay.
  await expect.poll(() => listRowIds(page), { timeout: 30_000 }).toEqual(["pays-cad", "usd-in-canada", "pays-usd"]);
  await expect(page.locator('[data-testid="job-row"][data-job-id="pays-usd"]').getByTestId("match-chip")).toHaveText("Outside Canada");
  await expect(page.getByTestId("list-left-out")).toContainText("1 outside where you can work");
  expect(asked.has("pays-usd")).toBe(true);
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

signedInTest("the list takes a role only on evidence the candidate can take it: a bare-city Settings place, a wider country tag, and ranks a role that names nowhere last", { tag: ["@J-JOBS-105"] }, async ({ page, diagnostics }) => {
  test.skip(Boolean(process.env.E2E_STORAGE_STATE), "reads its own saved Settings place, not a real account's");
  await returningVisitor(page);
  await withResume(page, "Toronto, Ontario, Canada");

  // Vivek 2026-10-05, in Canada: Island's "Technical Account Manager - U.S. Federal" and "(NY/NJ)" (Remote) were Good picks again.
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
  await answerFitList(
    page,
    [
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
    ],
    "e2e-eligibility-territory",
  );
  const asked = new Set<string>();
  await page.route("**/api/jobs/place-notes", async (route) => {
    for (const id of (route.request().postDataJSON() as { ids: string[] }).ids) asked.add(id);
    const notes = { "wide-us": { label: "United States", countries: ["United States"] }, "wide-open": null, nowhere: null };
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ notes }) });
  });
  await page.goto("/jobs");

  const rows = page.getByTestId("job-row");
  await expect(rows.first()).toBeVisible({ timeout: 60_000 });
  // The role that names nowhere comes last, under a country label rather than a fit word (J-JOBS-107): no evidence they can take it.
  await expect.poll(() => listRowIds(page).then((ids) => [ids.slice(0, -1).sort(), ids.at(-1)]), { timeout: 30_000 }).toEqual([["canada-enterprise", "in-canada", "wide-open"], "nowhere"]);
  for (const id of ["canada-enterprise", "in-canada", "wide-open"]) {
    await expect(rows.and(page.locator(`[data-job-id="${id}"]`)).getByTestId("match-chip").first()).not.toHaveText(/Outside/);
  }
  await expect(rows.and(page.locator('[data-job-id="nowhere"]')).getByTestId("match-chip").first()).toHaveText("Country unclear");
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
  await page.goto("/jobs?q=software%20engineer");

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

/** A fabricated career changer in Toronto: 13 years in all, the last 5 as a Technical Account Manager after 8 in engineering, none of it leading or senior (those carry a level up, resume-match.ts). */
async function withCareerChangerTamResume(page: Page) {
  await page.addInitScript(([enabledKey, resumeKey]) => {
    const resume = {
      profile: { name: "Alex Morgan", profession: "Technical Account Manager", yearsOfExperience: 13, location: "Toronto, Ontario, Canada", email: "alex.morgan@example.com", phone: "", linkedin: "", website: "" },
      experience: [
        { id: "e1", company: "Northwind", role: "Technical Account Manager", dates: "September 2021 - Present", description: "Own enterprise accounts, SLAs, escalations and renewals." },
        { id: "e2", company: "Contoso", role: "Software Engineer", dates: "February 2013 - April 2018", description: "Built backend services." },
      ],
      competencies: [{ category: "Account management", skills: ["Enterprise SaaS", "SLA governance", "Escalations"] }],
      education: [{ id: "ed1", degree: "B.Tech", institution: "State University", year: "2012" }],
      generatedSummary: "Technical Account Manager owning enterprise SaaS accounts.",
    };
    localStorage.setItem(enabledKey, "1");
    localStorage.setItem(resumeKey, JSON.stringify({ data: resume, updatedAt: new Date().toISOString(), sourceLabel: "e2e-journey-synthetic" }));
  }, [LOCAL_AI_ENABLED_KEY, LOCAL_AI_RESUME_KEY] as const);
}

test("the list reads a career changer's level from the years in the role they hold now, so senior roles in that role aren't listed, whether the listing or only the title says senior", { tag: ["@J-JOBS-110"] }, async ({ page, diagnostics }) => {
  // Vivek, 2026-10-06: "All the roles that are showing up are all senior roles ... ALL MY RECOMMENDATIONS SUCK".
  await returningVisitor(page);
  await withCareerChangerTamResume(page);
  const asked: string[] = [];
  page.on("request", (req) => {
    if (isListSearch(req) && req.postData()?.includes('"fromResume":true')) asked.push(req.postData() ?? "");
  });
  await answerFitList(
    page,
    [
      remoteRole("tam", "Technical Account Manager", "Remote, Canada", { tags: [] }),
      remoteRole("tam-senior", "Senior Technical Account Manager", "Remote, Canada", { tags: [], experience_level: "senior" }),
      remoteRole("tam-senior-title", "Senior Technical Account Manager, Enterprise", "Remote, Canada", { tags: [], experience_level: "unknown" }),
    ],
    "e2e-level",
  );
  await page.goto("/jobs");

  await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => listRowIds(page), { timeout: 30_000 }).toEqual(["tam"]);
  await expect(page.getByTestId("list-left-out")).toContainText("above your level");
  // The list asks search for roles at their level, not senior ones too.
  expect(asked.length).toBeGreaterThan(0);
  expect(asked.at(-1)).toMatch(/\bmid\b/);
  expect(asked.at(-1)).not.toMatch(/\bsenior\b/i);
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

signedInTest("a role above the candidate's level reads Stretch with its reason, whether its title runs a team or it asks for more years, and the fit list leaves it out", { tag: ["@J-JOBS-116"] }, async ({ page, diagnostics }) => {
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
  await page.goto("/jobs?q=customer%20success&sort=relevance");

  const rows = page.getByTestId("job-row");
  await expect(rows).toHaveCount(4, { timeout: 60_000 });
  const chip = (id: string) => page.locator(`[data-testid="job-row"][data-job-id="${id}"]`).getByTestId("match-chip");
  await expect(chip("cs-manager")).toHaveText("Stretch", { timeout: 60_000 });
  await expect(chip("tam-7y")).toHaveText("Stretch");
  await expect(chip("tam")).toHaveText("Strong");
  await expect(chip("csm")).toHaveText(/^(Strong|Good)$/);

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

  // The ranked list holds only roles at or near their level: the manager role is left out and counted.
  await page.goto("/jobs?q=customer%20success&sort=fit");
  await expect(page.getByTestId("list-left-out")).toContainText("above your level", { timeout: 60_000 });
  await expect(page.locator('[data-testid="job-row"][data-job-id="cs-manager"]')).toHaveCount(0);
  expect(withoutMockSignInHydration(diagnostics.pageErrors)).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

signedInTest("a role whose title manages people reads Stretch for a résumé that shows no one managed, at their level or not, with its reason, and the fit list leaves it out", { tag: ["@J-JOBS-117"] }, async ({ page, diagnostics }) => {
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
  await page.goto("/jobs?q=software%20engineer&sort=relevance");

  const rows = page.getByTestId("job-row");
  await expect(rows).toHaveCount(2, { timeout: 60_000 });
  const chip = (id: string) => page.locator(`[data-testid="job-row"][data-job-id="${id}"]`).getByTestId("match-chip");
  await expect(chip("ic")).toHaveText("Strong", { timeout: 60_000 });
  await expect(chip("manager")).toHaveText("Stretch");

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

test("an intern's résumé ranks entry-level roles, however long its dates run, and says the level came from their title", { tag: ["@J-JOBS-120"] }, async ({ page, diagnostics }) => {
  // Focus group, 2026-10-12: a "Data Science Intern" since January 2021 read as mid, and the Mid filter left
  // "Nothing matches these filters." The title held now sets the level: an intern is entry level.
  await returningVisitor(page);
  await page.addInitScript(([enabledKey, resumeKey]) => {
    const resume = {
      profile: { name: "Sample Intern", profession: "Data Science Intern", yearsOfExperience: 5, location: "Montreal, QC", email: "intern@example.com", phone: "", linkedin: "", website: "" },
      experience: [{ id: "e1", company: "Studio", role: "Data Science Intern", dates: "Jan 2021 - Present", description: "Built churn models in Python and scikit-learn." }],
      competencies: [{ category: "Skills", skills: ["Python", "SQL", "Pandas", "scikit-learn"] }],
      education: [],
      generatedSummary: "Graduate student in data science looking for an internship or new grad role.",
    };
    localStorage.setItem(enabledKey, "1");
    localStorage.setItem(resumeKey, JSON.stringify({ data: resume, updatedAt: new Date().toISOString(), sourceLabel: "e2e-journey-synthetic" }));
  }, [LOCAL_AI_ENABLED_KEY, LOCAL_AI_RESUME_KEY] as const);
  const levels: string[][] = [];
  page.on("request", (req) => {
    if (!isListSearch(req)) return;
    const level = (req.postDataJSON() as { facets?: Record<string, string[]> }).facets?.experience_level;
    if (level) levels.push(level);
  });
  const hits = [remoteRole("intern", "Data Science Intern", "Remote, Canada", { tags: [], experience_level: "entry" })];
  await page.route("**/api/jobs/search", (route) => answerListSearch(route, { hits, total: hits.length, backend: "meilisearch", configured: true, searchId: "e2e-intern-level" }));
  // A returning guest with a résumé opens /jobs on its matches (J-JOBS-54): the list asks for the résumé's level.
  await page.goto("/jobs");
  await expect(page).toHaveURL(/[?&]sort=fit/, { timeout: 30_000 });
  await expect(page.getByTestId("job-row")).toHaveCount(1, { timeout: 60_000 });
  await expect.poll(() => levels.length, { timeout: 15_000 }).toBeGreaterThan(0);
  expect(levels.every((level) => level.length === 1 && level[0] === "entry"), JSON.stringify(levels)).toBe(true);
  const chip = page.locator('[data-testid="job-row"][data-job-id="intern"]').getByTestId("match-chip");
  await expect(chip).toHaveText("Strong", { timeout: 60_000 });
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
  await expect(reason).toContainText("matches the entry level of your title, Data Science Intern");
  expect(diagnostics.pageErrors).toEqual([]);
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
  await page.goto("/jobs?q=software%20engineer&sort=fit");

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

const WEEKDAY_OR_YESTERDAY = "(yesterday|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)";

signedInTest("a list opened again says how many of its first roles are new since this device was last here, counting only fresh roles it had not listed", { tag: ["@J-JOBS-159"] }, async ({ page, diagnostics }) => {
  // Coordinator brief, 2026-10-21: stickiness for the one list ("N new matches since your last visit"), with the honest first-visit gate.
  await returningVisitor(page);
  await page.addInitScript(() => {
    if (sessionStorage.getItem("e2e-visit-seeded")) return;
    sessionStorage.setItem("e2e-visit-seeded", "1");
    localStorage.setItem("intervu.today.visit", JSON.stringify({ lastSeenAt: new Date(Date.now() - 3 * 86_400_000).toISOString(), since: null }));
    localStorage.setItem("intervu.today.seen", JSON.stringify(["listed-before"]));
  });
  await withResume(page, "Toronto, Ontario, Canada");
  const now = new Date().toISOString();
  const longAgo = new Date(Date.now() - 20 * 86_400_000).toISOString();
  await answerFitList(
    page,
    [
      remoteRole("listed-before", "Software Engineer", "Remote, Canada", { first_seen_at: now }),
      remoteRole("new-a", "Software Engineer", "Remote, Canada", { first_seen_at: now }),
      remoteRole("new-b", "Software Engineer", "Remote, Canada", { first_seen_at: now }),
      // Not listed on this device before, but 20 days old: further down a list it was always in, not new.
      remoteRole("old-unlisted", "Software Engineer", "Remote, Canada", { posted_at: longAgo, first_seen_at: longAgo }),
    ],
    "e2e-new-since",
  );
  await page.goto("/jobs?sort=fit");
  await expect(page.getByTestId("job-row")).toHaveCount(4, { timeout: 60_000 });
  // Two roles are new; the one listed last time and the old one are not.
  await expect(page.getByTestId("list-new-since")).toHaveText(new RegExp(`^2 new since ${WEEKDAY_OR_YESTERDAY}$`), { timeout: 30_000 });
  // One line about "since your last visit" on a ranked list, not a board-wide count above it.
  await expect(page.getByTestId("board-visit-banner")).toHaveCount(0);
  expect(withoutMockSignInHydration(diagnostics.pageErrors)).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

signedInTest("a list opened for the first time on a device makes no claim about what is new since a last visit", { tag: ["@J-JOBS-159"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await withResume(page, "Toronto, Ontario, Canada");
  const now = new Date().toISOString();
  await answerFitList(
    page,
    [remoteRole("first-a", "Software Engineer", "Remote, Canada", { first_seen_at: now }), remoteRole("first-b", "Software Engineer", "Remote, Canada", { first_seen_at: now })],
    "e2e-new-since-first",
  );
  await page.goto("/jobs?sort=fit");
  await expect(page.getByTestId("job-row")).toHaveCount(2, { timeout: 60_000 });
  await expect(page.getByTestId("result-line")).toBeVisible();
  await expect(page.getByTestId("list-new-since")).toHaveCount(0);
  expect(withoutMockSignInHydration(diagnostics.pageErrors)).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

signedInTest("a fit list on the résumé's own query shows an empty box that searches within the matches, and ranking a typed search keeps it", { tag: ["@J-JOBS-160"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await withResume(page, "Toronto, Ontario, Canada");
  await answerFitList(page, [remoteRole("fit-a", "Software Engineer", "Remote, Canada"), remoteRole("fit-b", "Software Engineer", "Remote, Canada")], "e2e-rank-keeps-query");
  // The résumé's own query is in the address but not in the box.
  await page.goto("/jobs");
  await expect(page).toHaveURL(/[?&]sort=fit/, { timeout: 30_000 });
  await expect(page.getByTestId("job-row")).toHaveCount(2, { timeout: 60_000 });
  await expect(page.getByLabel("Search", { exact: true }).first()).toHaveValue("");
  await expect(page.getByLabel("Search", { exact: true }).first()).toHaveAttribute("placeholder", "Search within your matches");
  // A search the visitor typed stays theirs when they rank it by fit.
  await page.goto("/jobs?q=nurse&sort=relevance");
  await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("jobs-sort-trigger").click();
  await page.getByTestId("jobs-sort-relevance").click();
  await expect(page).toHaveURL(/[?&]sort=fit/, { timeout: 30_000 });
  await expect(page).toHaveURL(/[?&]q=nurse/);
  await expect(page.getByLabel("Search", { exact: true }).first()).toHaveValue("nurse");
  expect(withoutMockSignInHydration(diagnostics.pageErrors)).toEqual([]);
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
  await expect(inUse).toContainText("Ranked by your résumé");

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

test("a failed ranked-list read shows an error with Retry, never the empty state", { tag: ["@J-JOBS-31"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await withResume(page, "Toronto, Ontario, Canada");
  let failing = true;
  const hits = [remoteRole("after-retry", "Software Engineer", "Remote, Canada")];
  await page.route("**/api/jobs/search", (route) =>
    failing
      ? route.fulfill({ status: 503, contentType: "text/plain", body: "journey stub: 503" })
      : answerListSearch(route, { hits, total: hits.length, backend: "meilisearch", configured: true, searchId: "e2e-after-retry" }),
  );
  await page.goto("/jobs");

  // One automatic retry (2-4 s) runs first, then the failure shows.
  const failed = page.getByTestId("jobs-search-error");
  await expect(failed).toBeVisible({ timeout: 30_000 });
  await expect(failed).toHaveAttribute("role", "alert");
  await expect(page.getByTestId("list-none-fit")).toHaveCount(0);
  await expect(page.getByTestId("job-row")).toHaveCount(0);

  // Retry re-reads: with the search answering again, the error clears and the list shows.
  failing = false;
  await page.getByTestId("jobs-search-error-retry").click();
  await expect(failed).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId("job-row")).toHaveCount(1, { timeout: 60_000 });
  expect(diagnostics.pageErrors).toEqual([]);
});

test("a role opened from the list shows the posting in its own sections, word for word", { tag: ["@J-DETAIL-43"] }, async ({ page, diagnostics }) => {
  // The For you card once sorted a posting into fixed "What you'll do / What you bring / Nice to have / Perks"
  // boxes, dropping whatever fit none of them (the company, pay); the card is gone and the list's role pane shows the
  // whole posting the way the card did: its own sections, each under a heading with its emoji (2026-10-01, 2026-10-21).
  await returningVisitor(page);
  await withResume(page, "Toronto, Ontario, Canada");
  await answerFitList(
    page,
    [remoteRole("expel-tam", "Software Engineer", "Remote, Canada", { company: "Expel", description: stripHtmlLikeIngest(EXPEL_TAM_HTML) })],
    "e2e-detail-sections",
  );
  await page.goto("/jobs");
  await page.getByTestId("job-row").getByTestId("job-title").first().click({ timeout: 60_000 });
  await expect(page).toHaveURL(/[?&]job=/, { timeout: 10_000 });

  const description = page.getByTestId("job-detail-description").and(page.locator(":visible"));
  await expect(description.getByRole("heading")).toHaveText([/About Expel$/, /What you’ll do$/, /What you should bring with you$/, /Compensation$/], { timeout: 30_000 });
  await expect(description.getByRole("list")).toHaveCount(2);
  await expect(description.getByText("The base salary range for this role is $150,000 - $180,000 USD, plus equity and benefits.")).toBeVisible();
  await expect(description.getByText("#LI-Remote")).toBeVisible();
  expect(diagnostics.pageErrors).toEqual([]);
});

test("a list whose search is down shows the error with Retry, never 'No roles in <country>' or another list's roles", { tag: ["@J-JOBS-52"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await withResume(page, "Toronto, Ontario, Canada");
  // What the server sends during a search outage: no rows, `unavailable`, and the résumé's place reported as
  // unmatched, because the place check fails too. The list used to say "No roles in Canada yet." instead of the error.
  let failing = true;
  const hits = [remoteRole("after-outage", "Software Engineer", "Remote, Canada")];
  await page.route("**/api/jobs/search", (route) =>
    answerListSearch(
      route,
      failing
        ? { hits: [], total: 0, backend: "meilisearch", configured: true, unavailable: true, note: SEARCH_UNAVAILABLE_MESSAGE, searchId: "journey-outage", unmatchedPlaceMentions: ["Canada"] }
        : { hits, total: hits.length, backend: "meilisearch", configured: true, searchId: "journey-back" },
    ),
  );
  await page.goto("/jobs");

  // One automatic retry (2-4 s) runs first, then the failure shows.
  const failed = page.getByTestId("jobs-search-error");
  await expect(failed).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("list-none-fit")).toHaveCount(0);
  await expect(page.getByTestId("job-row")).toHaveCount(0);

  // Search is back: Retry lists the résumé's own roles.
  failing = false;
  await page.getByTestId("jobs-search-error-retry").click();
  await expect(failed).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 60_000 });
  expect(diagnostics.pageErrors).toEqual([]);
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

test("an employer search with a place says where its roles in that place end and its roles elsewhere begin", { tag: ["@J-SRCH-37"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  // The employer's roles in the asked-for place come first, the rest follow with the employer's true
  // total; the caption says where the first group ends. The server half (a role word like "warehouse"
  // is not an employer, the total is not a pool-size cap) is unit-tested in jobs-company-intent.test.ts
  // and jobs-company-lane-paging.test.ts.
  let inPlace = 2;
  const hits = [
    remoteRole("here-1", "Store Associate", "Toronto, ON", { company: "Walmart" }),
    remoteRole("here-2", "Cashier", "Toronto, ON", { company: "Walmart" }),
    remoteRole("there-1", "Store Associate", "Austin, TX", { company: "Walmart" }),
  ];
  await page.route("**/api/jobs/search", (route) =>
    answerListSearch(route, { hits, total: 240, inPlace, backend: "meilisearch", configured: true, searchId: "e2e-employer-elsewhere" }),
  );
  const note = page.getByTestId("employer-elsewhere-note");

  await page.goto("/jobs?q=walmart&country=Canada");
  await expect(note).toHaveText("Showing 2 roles in your location first, then this employer's roles elsewhere.", { timeout: 60_000 });

  // None in the place: say so rather than listing the other places' roles as if they matched.
  inPlace = 0;
  await page.goto("/jobs?q=walmart&country=Canada&exp=mid");
  await expect(note).toHaveText("No roles at this employer match your location — showing its roles elsewhere.", { timeout: 60_000 });
  expect(diagnostics.serverErrors).toEqual([]);
  // The stub lists 3 of 240 roles, so the page asks for the next ones too, and that request can still
  // be waiting on the real server when the test ends. Closing the page under it made the stub's
  // route.fetch throw "Target page, context or browser has been closed". Nothing here reads its answer.
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

import type { Page } from "@playwright/test";
import { JOBS_VISITOR_COOKIE } from "../../../src/lib/jobs-visitor-cookie";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { PACKS_HOME_INTRO_KEY } from "../../../src/lib/jobs/for-you/packs-home-intro";
import { expect, test } from "./fixtures";

// Guest résumé path: src/lib/local-ai/flag.ts + resume-storage.ts (same seeding tests/e2e/jobs-first-paint.spec.ts proves).
const LOCAL_AI_ENABLED_KEY = "velai.localAi.enabled";
const LOCAL_AI_RESUME_KEY = "velai.localAi.resume";

/** Journeys for the /jobs area — see tests/journeys/CATALOG.md (J-JOBS-01/23/24/25/26/27/31/37/38, J-SRCH-03, J-SRCH-21, J-DETAIL-01). Read-only. */

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

/** Fresh = empty storage. Previous-session = the visit cookie is set but velai.onboarding.completed is not. */
const VISITORS = [
  { name: "fresh visitor", previousSession: false },
  { name: "previous-session visitor (onboarding flag unset)", previousSession: true },
];

async function openJobs(page: Page, baseURL: string | undefined, previousSession: boolean) {
  if (previousSession) await page.context().addCookies([{ name: JOBS_VISITOR_COOKIE, value: "1", url: baseURL! }]);
  await page.goto("/jobs");
}

test("first-time visitor opens /jobs and sees the search box and job rows on first paint", { tag: ["@J-JOBS-01"] }, async ({ page, diagnostics }) => {
  const res = await page.goto("/jobs");
  expect(res?.status()).toBe(200);
  await expectBoard(page);
  await expect(page.locator(POSTER)).toHaveCount(0);
  await expect(page.locator("h1:visible")).toHaveCount(1);
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

for (const visitor of VISITORS) {
  test(`${visitor.name} clicks a row title and the job detail opens`, { tag: ["@J-JOBS-23"] }, async ({ page, baseURL }) => {
    await openJobs(page, baseURL, visitor.previousSession);
    await expectBoard(page);
    // The row centre is the company link; the title is the detail affordance.
    await page.getByTestId("job-row").getByTestId("job-title").first().click();
    await expect(page).toHaveURL(/[?&]job=/, { timeout: 10_000 });
    await expect(page.locator('[data-testid="detail-pane"]:visible, [data-testid="mobile-detail-scroller"]:visible').first()).toBeVisible();
  });

  test(`${visitor.name} clicks Sign in or Get started and the board is still there 2s later`, { tag: ["@J-JOBS-24"] }, async ({ page, baseURL }) => {
    await openJobs(page, baseURL, visitor.previousSession);
    await expectBoard(page);
    // By accessible name, so any visible entry point counts, not one testid.
    const cta = page
      .getByRole("button", { name: /^(sign in|get started)$/i })
      .or(page.getByRole("link", { name: /^(sign in|get started)$/i }));
    await expect(cta.first()).toBeVisible();
    await cta.first().click();
    await page.waitForTimeout(2_000);
    await expectBoard(page, 1_000);
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
  await page.goto("/jobs");
  await expectBoard(page);
  await expect.poll(() => events, { timeout: 15_000, message: "results_impressed after first render" }).toContain("results_impressed");

  await page.locator(SEARCH_INPUT).first().fill("engineer");
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

/** Fabricated candidate (no real person) whose résumé location is `location`. */
const guestWithResume = (page: Page, location: string) =>
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

test("a For-you pack opened from the hub, past the intro, has Edit filters on exactly the pack's filters, and a thin pack offers to broaden", { tag: ["@J-JOBS-27"] }, async ({ page, diagnostics }) => {
  // Iceland: a country with few software roles, so the pack is thin whatever the corpus holds today.
  await guestWithResume(page, "Reykjavik, Iceland");
  await page.goto("/jobs?view=for-you");
  // For you opens on the packs hub; its first-visit intro must not block the pack controls once dismissed.
  await page.getByTestId("packs-home-intro-got-it").click({ timeout: 30_000 });
  await expect(page.getByTestId("packs-home-intro-modal")).toHaveCount(0);
  await page.getByTestId("hub-pack-card-all").click();
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

test("a For-you pack in a country with no roles says so, never listing roles from elsewhere", { tag: ["@J-JOBS-37"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  // Tuvalu: a country the corpus has no roles in. The search drops a place it cannot filter
  // on; the pack used to list the whole corpus (or the visitor's own country) as its matches.
  await guestWithResume(page, "Funafuti, Tuvalu");
  await page.goto("/jobs?view=for-you");
  await page.getByTestId("hub-pack-card-all").click({ timeout: 30_000 });

  const none = page.getByTestId("for-you-no-roles-there");
  await expect(none).toBeVisible({ timeout: 30_000 });
  await expect(none).toContainText("No roles in Tuvalu yet.");
  await expect(page.getByTestId("for-you-deck")).toHaveCount(0);
  // The pack counts 0 there, so the broaden options offer the way out, each with its count.
  const broaden = page.getByTestId("broaden-options");
  await expect(broaden).toBeVisible({ timeout: 30_000 });
  await expect(broaden.getByRole("link").first()).toContainText(/\d[\d,]* roles/);
  expect(diagnostics.serverErrors).toEqual([]);
});

test("a pack tile opens the pack with the tile's own filter, and the next tile does not inherit it", { tag: ["@J-JOBS-38"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  await guestWithResume(page, "Toronto, Ontario, Canada");
  await page.goto("/jobs?view=for-you");
  const editHref = async () => {
    const edit = page.getByTestId("pack-edit-filters");
    await expect(edit).toBeVisible({ timeout: 30_000 });
    return new URL((await edit.getAttribute("href"))!, "http://x").searchParams;
  };

  // Fully remote: the pack (its country) with the remote work type on top.
  await page.getByTestId("hub-pack-card-remote").click({ timeout: 30_000 });
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

test("a failed ranked-list read shows an error with Retry, never the empty state", { tag: ["@J-JOBS-31"] }, async ({ page }) => {
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  await guestWithResume(page, "Toronto, Ontario, Canada");
  const recover = await failEveryAction(page);
  await page.goto("/jobs?view=for-you");
  await page.getByTestId("hub-pack-card-all").click();

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

import type { Page } from "@playwright/test";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { PACKS_HOME_INTRO_KEY } from "../../../src/lib/jobs/for-you/packs-home-intro";
import { LOCAL_AI_RESUME_KEY } from "../../../src/lib/local-ai/resume-storage";
import { expect, test } from "./fixtures";
import { answerListSearch, isListSearch } from "./list-search";
import { signedInTest, signInLikeProduction, withActionResult, withoutMockSignInHydration } from "./signed-in";

/**
 * Personalised matching fixes, review 2026-10-13 — see tests/journeys/CATALOG.md (J-JOBS-121 to 123).
 * Read-only: the résumé and the guest tracker live in localStorage, and the list search's answer
 * is replaced in the browser (the search still runs), as in match-order.spec.ts.
 *
 * - J-JOBS-121 / J-JOBS-126 "The jobs I have applied to keep coming back and there is no badge":
 *   the corpus re-lists the same opening under a new id, and no list row said a role was applied
 *   to. Applying needs an account (a guest's Apply opens "Sign in to apply", J-APPLY-01), so these
 *   run signed in, with the account's tracker answered in the browser.
 * - J-JOBS-122 "returning recent jobs instead of jobs from 1 month ago": among roles that fit
 *   alike, the newest leads; a role over two weeks old ranks after this week's.
 * - J-JOBS-123 "the more/less like this role should give reasons and take that as input".
 */

const DAY_MS = 86_400_000;

const returningVisitor = (page: Page) =>
  page.addInitScript((key) => localStorage.setItem(key, "1"), ONBOARDING_COMPLETED_STORAGE_KEY);

/** Fabricated candidate (no real person): a Toronto Technical Account Manager — the same one as match-order.spec.ts. */
const TAM_RESUME = {
  profile: { name: "Morgan Lee", profession: "Technical Account Manager", yearsOfExperience: 9, location: "Toronto, Ontario, Canada", email: "morgan.lee.e2e@example.com", phone: "555-010-4477", linkedin: "", website: "" },
  experience: [
    { id: "exp1", company: "Northwind Cloud", role: "Technical Account Manager", dates: "2019 - Present", description: "Owned adoption, renewals and technical escalations for 40 enterprise accounts; worked with product managers on the roadmap." },
    { id: "exp2", company: "Maple Systems", role: "Technical Support Engineer", dates: "2015 - 2019", description: "Resolved API and integration issues for enterprise customers." },
  ],
  competencies: [{ category: "Skills", skills: ["Customer Success", "Product Management", "SQL", "REST APIs", "Salesforce"] }],
  education: [{ id: "edu1", degree: "B.Eng. Computer Engineering", institution: "State University", year: "2015" }],
  generatedSummary: "Technical Account Manager with nine years in customer success and product delivery for enterprise SaaS customers.",
};

const seedResume = (page: Page) =>
  page.addInitScript(
    ([resumeKey, data]) => {
      localStorage.setItem(resumeKey as string, JSON.stringify({ data, updatedAt: new Date().toISOString(), sourceLabel: "e2e-synthetic" }));
    },
    [LOCAL_AI_RESUME_KEY, TAM_RESUME] as const,
  );

const posting = (id: string, title: string, company: string, experience_level: string, daysOld = 1) => {
  const posted = new Date(Date.now() - daysOld * DAY_MS).toISOString();
  return {
    id,
    title,
    company,
    company_domain: null,
    location: "Toronto, ON",
    location_city: "Toronto",
    location_state: "Ontario",
    location_country: "Canada",
    work_type: "hybrid",
    description: null,
    employment_type: "full_time",
    experience_level,
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_period: null,
    visa_sponsorship: null,
    tags: [],
    apply_url: "https://example.com/apply",
    source: "journey",
    posted_at: posted,
    posted_ts: Date.parse(posted),
    first_seen_at: null,
    updated_at: null,
    vacancy_status: "open",
    ghost_badge: "unscored",
  };
};

/** The list's first page answers with `listed`, in the browser only. */
const answerResumeSearch = (page: Page, listed: object[], searchId: string) =>
  page.route("**/*", async (route) => {
    const req = route.request();
    const body = req.postData() ?? "";
    if (!isListSearch(req) || !body.includes('"withFacets":true') || !body.includes('"offset":0')) return route.fallback();
    return answerListSearch(route, { hits: listed, total: listed.length, backend: "meilisearch", configured: true, searchId });
  });

// Route handlers still answering when a test ends must not fail it (as in job-tracked-stage.spec.ts).
test.afterEach(({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));
signedInTest.afterEach(({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));

const rowIds = (page: Page) => page.getByTestId("job-row").evaluateAll((els) => els.map((el) => el.getAttribute("data-job-id")));

/**
 * The account's tracker, answered in the browser: `getApplications` (the one server action that
 * lists it) is told apart from the other list actions by the id the page's own bundle gives it —
 * `createServerReference("<id>", …, "getApplications")`, in dev and production builds alike.
 * Signed in the way production is (`signInLikeProduction`); every other action keeps its answer.
 */
async function withAccountApplications(page: Page, applications: object[]) {
  let actionId: string | null = null;
  await page.route(/\/_next\/static\/chunks\/.*\.js(\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    const found = body.match(/\("([0-9a-f]{40,44})",[^)]{0,1500}?"getApplications"\)/);
    if (found) actionId = found[1]!;
    return route.fulfill({ response, body });
  });
  await signInLikeProduction(page, () => undefined);
  await page.route(
    () => true,
    async (route) => {
      const req = route.request();
      if (req.method() !== "POST" || !actionId || req.headers()["next-action"] !== actionId) return route.fallback();
      const res = await route.fetch();
      return route.fulfill({ response: res, body: withActionResult(await res.text(), { data: applications }) });
    },
  );
  return () => actionId;
}

/** Northstar Data's Technical Account Manager role in Toronto, applied to two days ago under the id it had then. */
const APPLIED_AT = new Date(Date.now() - 2 * DAY_MS).toISOString();
const NORTHSTAR_APPLICATION = {
  id: "journey-application-1",
  user_id: "journey-account",
  company_name: "Northstar Data",
  position: "Technical Account Manager",
  status: "applied",
  job_id: "journey-old-listing-id",
  job_snapshot: { title: "Technical Account Manager", company: "Northstar Data", location: "Toronto, ON", description: null, apply_url: "https://example.com/apply" },
  applied_at: APPLIED_AT,
  created_at: APPLIED_AT,
  updated_at: APPLIED_AT,
};
const RELISTED = posting("55555555-0000-4000-8000-000000000001", "Technical Account Manager", "Northstar Data", "senior");
const OTHER_TAM = posting("55555555-0000-4000-8000-000000000002", "Technical Account Manager", "Beacon Cloud", "senior");

test("a role the account applied to is badged Applied in the list, also when the same opening is listed again under a new id", { tag: ["@J-JOBS-121"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await seedResume(page);
  const applicationsActionId = await withAccountApplications(page, [NORTHSTAR_APPLICATION]);
  await answerResumeSearch(page, [RELISTED, OTHER_TAM], "journey-applied");
  await page.goto("/jobs?view=search&sort=fit");
  await expect(page.getByTestId("topbar-avatar")).toBeVisible({ timeout: 30_000 });

  const row = (id: string) => page.locator(`[data-testid="job-row"][data-job-id="${id}"]`);
  await expect(row(RELISTED.id)).toBeVisible({ timeout: 60_000 });
  expect(applicationsActionId(), "the page's bundle names its getApplications action").not.toBeNull();
  await expect(row(RELISTED.id).getByTestId("job-applied-badge")).toHaveText("Applied", { timeout: 30_000 });
  await expect(row(OTHER_TAM.id).getByTestId("job-applied-badge")).toHaveCount(0);
  expect(diagnostics.pageErrors).toEqual([]);
});

test("among roles that fit alike, the résumé's ranked list leads with this week's and puts one over two weeks old after them", { tag: ["@J-JOBS-122"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await seedResume(page);
  // Same role, same level, same place: they fit alike. Sent oldest first, the order relevance gave them.
  const old = posting("66666666-0000-4000-8000-000000000001", "Technical Account Manager", "Harbor Pay", "senior", 25);
  const lastWeek = posting("66666666-0000-4000-8000-000000000002", "Technical Account Manager", "Lumen Analytics", "senior", 10);
  const thisWeek = posting("66666666-0000-4000-8000-000000000003", "Technical Account Manager", "Cedar Health", "senior", 2);
  await answerResumeSearch(page, [old, lastWeek, thisWeek], "journey-fresh");
  await page.goto("/jobs?view=search&sort=fit");

  await expect(page.getByTestId("job-row")).toHaveCount(3, { timeout: 60_000 });
  await expect.poll(() => rowIds(page), { timeout: 30_000 }).toEqual([thisWeek.id, lastWeek.id, old.id]);
  expect(diagnostics.pageErrors).toEqual([]);
});

/** Open the packs hub's "all" pack. The hub paints before it hydrates, so tap until the pack opens. */
async function openPack(page: Page) {
  await page.goto("/jobs?view=for-you");
  const card = page.getByTestId("hub-pack-card-all");
  const back = page.getByTestId("jobs-back-to-packs");
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(async () => {
    if (!(await back.isVisible())) await card.click({ timeout: 5_000 });
    await expect(back).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
}

/** As ranked for the TAM résumé: its own role, two customer success roles, then the rest. */
const PACK = [
  posting("77777777-0000-4000-8000-000000000001", "Technical Account Manager", "Northstar Data", "senior"),
  posting("77777777-0000-4000-8000-000000000002", "Senior Customer Success Manager", "Orchard CRM", "senior"),
  posting("77777777-0000-4000-8000-000000000003", "Senior Customer Success Manager", "Juniper Labs", "senior"),
  posting("77777777-0000-4000-8000-000000000004", "Solutions Engineer", "Orchard CRM", "senior"),
  posting("77777777-0000-4000-8000-000000000005", "Technical Support Manager", "Fernway", "senior"),
  posting("77777777-0000-4000-8000-000000000006", "Technical Support Manager", "Kestrel IO", "senior"),
];
const [TAM, ORCHARD_CSM, JUNIPER_CSM] = PACK.map((p) => p.id);

signedInTest("fewer like this asks why, and the reason steers: \"This company\" turns the deck away from the employer, not the role", { tag: ["@J-JOBS-123"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  await seedResume(page);
  await answerResumeSearch(page, PACK, "journey-reasons");
  await openPack(page);

  const stack = page.locator('[data-testid="for-you-deck"] [data-testid="role-stack"]');
  const front = stack.locator('[data-testid="role-stack-card"][data-stack-pose="front"]');
  const upcoming = stack.locator('[data-testid="role-stack-card"][data-stack-pose="upcoming"]');
  const position = page.getByTestId("for-you-deck-position");
  const tuned = page.getByTestId("deck-tuning");
  const why = page.getByTestId("tuning-reason-prompt");

  await expect(front).toHaveAttribute("data-job-id", TAM, { timeout: 60_000 });
  await page.getByTestId("for-you-next").click();
  await expect(front).toHaveAttribute("data-job-id", ORCHARD_CSM);
  await expect(why).toHaveCount(0);

  // The tap works on its own: the role goes, the deck guesses (the other customer success role
  // moves away), and the deck asks why. Which role comes next can also move with a "dwell" nudge
  // (20 s on a role, ForYouHome) on a slow run, so this reads what holds either way.
  await front.getByTestId("role-fewer-like-this").click();
  await expect(position).toHaveText("Role 2 of 5");
  await expect(front).not.toHaveAttribute("data-job-id", ORCHARD_CSM);
  await expect(why).toContainText("Fewer like Customer Success Manager — why?");
  await expect(tuned).toContainText("Tuned away from Customer Success Manager.");
  await expect(upcoming).not.toHaveAttribute("data-job-id", JUNIPER_CSM);
  const onScreen = await front.getAttribute("data-job-id");

  // "This company": it was Orchard CRM, not customer success. The role on screen stays put; the
  // other customer success role comes back next, and the line names the employer.
  await page.getByTestId("tuning-reason-company").click();
  await expect(why).toHaveCount(0);
  await expect(tuned).toContainText("Tuned away from Orchard CRM.");
  await expect(front).toHaveAttribute("data-job-id", onScreen!);
  await expect(upcoming).toHaveAttribute("data-job-id", JUNIPER_CSM);

  // Reset clears the reason with the nudge.
  await page.getByTestId("deck-tuning-reset").click();
  await expect(tuned).toHaveCount(0);
  expect(withoutMockSignInHydration(diagnostics.pageErrors)).toEqual([]);
});

test("a pack never deals a role the account applied to, nor the same opening listed again under a new id", { tag: ["@J-JOBS-126"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  await seedResume(page);
  await withAccountApplications(page, [NORTHSTAR_APPLICATION]);
  const csm = posting("55555555-0000-4000-8000-000000000003", "Senior Customer Success Manager", "Orchard CRM", "senior");
  await answerResumeSearch(page, [RELISTED, OTHER_TAM, csm], "journey-pack-applied");
  await openPack(page);

  const stack = page.locator('[data-testid="for-you-deck"] [data-testid="role-stack"]');
  const front = stack.locator('[data-testid="role-stack-card"][data-stack-pose="front"]');
  const position = page.getByTestId("for-you-deck-position");
  // The other employer's TAM role leads; the applied Northstar opening is not in the deck at all.
  await expect(front).toHaveAttribute("data-job-id", OTHER_TAM.id, { timeout: 60_000 });
  await expect(position).toHaveText("Role 1 of 2");
  await expect(stack.locator(`[data-testid="role-stack-card"][data-job-id="${RELISTED.id}"]`)).toHaveCount(0);
  await page.getByTestId("for-you-next").click();
  await expect(front).toHaveAttribute("data-job-id", csm.id);
  expect(diagnostics.pageErrors).toEqual([]);
});

test("a pack leads with this month's roles over an older own-title one, and leaves out roles over 60 days old", { tag: ["@J-JOBS-127"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  await seedResume(page);
  // Sent own-title first, the order the role tier alone gave them (live TAM pack, 2026-10-13).
  const ancient = posting("88888888-0000-4000-8000-000000000001", "Technical Account Manager", "Braze Cloud", "senior", 85);
  const stale = posting("88888888-0000-4000-8000-000000000002", "Technical Account Manager", "Docent Labs", "senior", 45);
  const fresh = posting("88888888-0000-4000-8000-000000000003", "Senior Customer Success Manager", "Maple CRM", "senior", 3);
  await withAccountApplications(page, []);
  await answerResumeSearch(page, [ancient, stale, fresh], "journey-pack-age");
  await openPack(page);

  const stack = page.locator('[data-testid="for-you-deck"] [data-testid="role-stack"]');
  const front = stack.locator('[data-testid="role-stack-card"][data-stack-pose="front"]');
  await expect(front).toHaveAttribute("data-job-id", fresh.id, { timeout: 60_000 });
  await expect(page.getByTestId("for-you-deck-position")).toHaveText("Role 1 of 2");
  await expect(stack.locator(`[data-testid="role-stack-card"][data-job-id="${ancient.id}"]`)).toHaveCount(0);
  await page.getByTestId("for-you-next").click();
  await expect(front).toHaveAttribute("data-job-id", stale.id);
  expect(diagnostics.pageErrors).toEqual([]);
});

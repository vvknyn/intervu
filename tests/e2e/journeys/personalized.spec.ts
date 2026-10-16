import type { Page } from "@playwright/test";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { PACKS_HOME_INTRO_KEY } from "../../../src/lib/jobs/for-you/packs-home-intro";
import { LOCAL_AI_RESUME_KEY } from "../../../src/lib/local-ai/resume-storage";
import { jdTermsFromDescription } from "../../../src/lib/match/jd-match";
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

const seedResume = (page: Page, resume: object = TAM_RESUME) =>
  page.addInitScript(
    ([resumeKey, data]) => {
      localStorage.setItem(resumeKey as string, JSON.stringify({ data, updatedAt: new Date().toISOString(), sourceLabel: "e2e-synthetic" }));
    },
    [LOCAL_AI_RESUME_KEY, resume] as const,
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
  const position = page.getByTestId("for-you-deck-position");
  const tuned = page.getByTestId("deck-tuning");
  const why = page.getByTestId("tuning-reason-prompt");

  await expect(front).toHaveAttribute("data-job-id", TAM, { timeout: 60_000 });
  await page.getByTestId("for-you-next").click();
  await expect(front).toHaveAttribute("data-job-id", ORCHARD_CSM);
  await expect(why).toHaveCount(0);

  // The tap works on its own: the role goes, the deck guesses (away from customer success), and the
  // deck asks why. The other customer success role is the résumé's kind of work, so the guess moves
  // it within its fit band but never below roles the résumé has not held (J-JOBS-139).
  await front.getByTestId("role-fewer-like-this").click();
  await expect(position).toHaveText("Role 2 of 5");
  await expect(front).toHaveAttribute("data-job-id", JUNIPER_CSM);
  await expect(why).toContainText("Fewer like Customer Success Manager — why?");
  await expect(tuned).toContainText("Tuned away from Customer Success Manager.");

  // "This company": it was Orchard CRM, not customer success. The role on screen stays put and the
  // line names the employer.
  await page.getByTestId("tuning-reason-company").click();
  await expect(why).toHaveCount(0);
  await expect(tuned).toContainText("Tuned away from Orchard CRM.");
  await expect(front).toHaveAttribute("data-job-id", JUNIPER_CSM);

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
  // The two roles not applied to make the deck, in fit order (whole résumé against whole posting,
  // 2026-10-13); the applied Northstar opening is not in it at all.
  await expect(position).toHaveText("Role 1 of 2", { timeout: 60_000 });
  await expect(stack.locator(`[data-testid="role-stack-card"][data-job-id="${RELISTED.id}"]`)).toHaveCount(0);
  const first = await front.getAttribute("data-job-id");
  expect([OTHER_TAM.id, csm.id]).toContain(first);
  await page.getByTestId("for-you-next").click();
  await expect(front).toHaveAttribute("data-job-id", first === OTHER_TAM.id ? csm.id : OTHER_TAM.id);
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

/** Fabricated (no real person): the résumé that replaces the TAM one — a Toronto registered nurse. */
const NURSE_RESUME_TEXT = `Jordan Reyes
Registered Nurse
Toronto, Ontario, Canada · jordan.reyes.e2e@example.com · 555-010-9911

Summary
Registered Nurse with seven years of acute care and ICU nursing.

Experience
Registered Nurse, Lakeshore General Hospital — 2019 - Present
Critical care nursing for a 24-bed ICU; patient assessment, medication administration, charting in Epic.

Registered Practical Nurse, Maple Long Term Care — 2017 - 2019
Resident care, wound care and family education.

Education
BScN, Nursing, Toronto Metropolitan University, 2017

Skills
Critical Care, Patient Assessment, Epic, BLS, ACLS`;

test("replacing the résumé refreshes the pack at once, with no reload: a TAM's deck becomes a nurse's", { tag: ["@J-JOBS-128"] }, async ({ page, diagnostics }) => {
  // Vivek, 2026-10-13: "every time I upload a new resume the recommendations do not auto refresh".
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  await seedResume(page);
  const tam = posting("99999999-0000-4000-8000-000000000001", "Technical Account Manager", "Northstar Data", "senior");
  const nurse = posting("99999999-0000-4000-8000-000000000002", "Registered Nurse, ICU", "Lakeshore Health", "mid");
  await withAccountApplications(page, []);
  await page.route("**/*", async (route) => {
    const req = route.request();
    const body = req.postData() ?? "";
    if (!isListSearch(req) || !body.includes('"withFacets":true') || !body.includes('"offset":0')) return route.fallback();
    const listed = /nurs/i.test(body) ? [nurse] : [tam];
    return answerListSearch(route, { hits: listed, total: 1, backend: "meilisearch", configured: true, searchId: "journey-replace" });
  });

  await openPack(page);
  const front = page.locator('[data-testid="for-you-deck"] [data-testid="role-stack"] [data-testid="role-stack-card"][data-stack-pose="front"]');
  await expect(front).toHaveAttribute("data-job-id", tam.id, { timeout: 60_000 });
  // A reload would drop this mark.
  await page.evaluate(() => { (window as unknown as { __sameDocument?: boolean }).__sameDocument = true; });

  // Replace from the packs hub (the deck's own Replace is desktop-only).
  await page.locator('[data-testid="jobs-back-to-packs"]:visible').first().click();
  await page.getByRole("region", { name: "Job categories" }).getByRole("button", { name: "Replace", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[type="file"]').setInputFiles({ name: "jordan.txt", mimeType: "text/plain", buffer: Buffer.from(NURSE_RESUME_TEXT) });
  await dialog.getByTestId("resume-import-parse-primary").click();
  const confirm = dialog.locator('[data-slot="dialog-footer"]').getByRole("button").last();
  await expect(confirm).toBeEnabled({ timeout: 15_000 });
  await confirm.click();

  // The pack is dealt again from the new résumé, in place.
  await expect(async () => {
    if (!(await front.isVisible())) {
      const back = page.getByTestId("jobs-back-to-packs");
      if (!(await back.isVisible())) await page.getByTestId("hub-pack-card-all").click({ timeout: 5_000 });
    }
    await expect(front).toHaveAttribute("data-job-id", nurse.id, { timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
  expect(await page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument), "no page reload").toBe(true);
  expect(diagnostics.pageErrors).toEqual([]);
});

test("a pack reaches a month of roles: the deck asks for 150 résumé-ranked rows, not the newest 60", { tag: ["@J-JOBS-129"] }, async ({ page, diagnostics }) => {
  // Vivek, 2026-10-13: the index orders a broad role query newest first, so 60 rows held only ~2 weeks
  // of PM roles and missed Thumbtack's 29-day-old PM, Growth, which other portals recommended.
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  await seedResume(page);
  const limits: number[] = [];
  await withAccountApplications(page, []);
  await page.route("**/*", async (route) => {
    const req = route.request();
    const body = req.postData() ?? "";
    if (!isListSearch(req) || !body.includes('"withFacets":true') || !body.includes('"offset":0')) return route.fallback();
    const parsed = JSON.parse(body) as { limit?: number; fromResume?: boolean };
    if (parsed.fromResume) limits.push(parsed.limit ?? 0);
    const tam = posting("99999999-0000-4000-8000-000000000011", "Technical Account Manager", "Northstar Data", "senior");
    return answerListSearch(route, { hits: [tam], total: 1, backend: "meilisearch", configured: true, searchId: "journey-depth" });
  });
  await openPack(page);
  await expect.poll(() => Math.max(0, ...limits), { timeout: 30_000 }).toBe(150);
  expect(diagnostics.pageErrors).toEqual([]);
});

test("a pack never deals a Staff, Principal or Director role to a résumé that shows none, and asks the search to leave them out", { tag: ["@J-JOBS-130"] }, async ({ page, diagnostics }) => {
  // Vivek, 2026-10-14: "the majority of them are staff level... way senior to senior roles". The scale ends at
  // senior, so these read senior and fitted; a role past Senior is now left out of the pool and of the deck.
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  await seedResume(page);
  const marks: { omitPastSenior?: boolean }[] = [];
  const own = posting("55555555-0000-4000-8000-000000000001", "Technical Account Manager", "Northstar Data", "senior", 2);
  const senior = posting("55555555-0000-4000-8000-000000000002", "Senior Customer Success Manager", "Orchard CRM", "senior", 3);
  const staff = posting("55555555-0000-4000-8000-000000000003", "Staff Technical Account Manager", "Juniper Labs", "senior", 1);
  const principal = posting("55555555-0000-4000-8000-000000000004", "Principal Customer Success Manager", "Fernway", "senior", 1);
  const director = posting("55555555-0000-4000-8000-000000000005", "Director, Customer Success", "Kestrel IO", "senior", 1);
  const executive = posting("55555555-0000-4000-8000-000000000006", "Customer Success Manager", "Harbor Pay", "executive", 1);
  await withAccountApplications(page, []);
  await page.route("**/*", async (route) => {
    const req = route.request();
    const body = req.postData() ?? "";
    if (!isListSearch(req) || !body.includes('"withFacets":true') || !body.includes('"offset":0')) return route.fallback();
    const parsed = JSON.parse(body) as { fromResume?: boolean; omitPastSenior?: boolean };
    if (parsed.fromResume) marks.push({ omitPastSenior: parsed.omitPastSenior });
    // Sent anyway, as a cached or older answer could: the deck still leaves them out.
    const hits = [staff, principal, director, executive, own, senior];
    return answerListSearch(route, { hits, total: hits.length, backend: "meilisearch", configured: true, searchId: "journey-past-senior" });
  });
  await openPack(page);

  const stack = page.locator('[data-testid="for-you-deck"] [data-testid="role-stack"]');
  await expect(page.getByTestId("for-you-deck-position")).toHaveText("Role 1 of 2", { timeout: 60_000 });
  for (const gone of [staff, principal, director, executive]) {
    await expect(stack.locator(`[data-testid="role-stack-card"][data-job-id="${gone.id}"]`)).toHaveCount(0);
  }
  expect(marks.length).toBeGreaterThan(0);
  expect(marks.every((m) => m.omitPastSenior === true), "every résumé-built search asks to leave out roles past Senior").toBe(true);
  expect(diagnostics.pageErrors).toEqual([]);
});

test("a résumé whose own title is Staff keeps Staff roles: the pack does not ask the search to leave them out", { tag: ["@J-JOBS-130"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  const staffResume = {
    ...TAM_RESUME,
    profile: { ...TAM_RESUME.profile, profession: "Staff Technical Account Manager" },
    experience: [{ ...TAM_RESUME.experience[0]!, role: "Staff Technical Account Manager" }, ...TAM_RESUME.experience.slice(1)],
  };
  await seedResume(page, staffResume);
  const marks: { omitPastSenior?: boolean }[] = [];
  const staff = posting("44444444-0000-4000-8000-000000000001", "Staff Technical Account Manager", "Juniper Labs", "senior", 1);
  await withAccountApplications(page, []);
  await page.route("**/*", async (route) => {
    const req = route.request();
    const body = req.postData() ?? "";
    if (!isListSearch(req) || !body.includes('"withFacets":true') || !body.includes('"offset":0')) return route.fallback();
    const parsed = JSON.parse(body) as { fromResume?: boolean; omitPastSenior?: boolean };
    if (parsed.fromResume) marks.push({ omitPastSenior: parsed.omitPastSenior });
    return answerListSearch(route, { hits: [staff], total: 1, backend: "meilisearch", configured: true, searchId: "journey-staff-keeps" });
  });
  await openPack(page);

  const front = page.locator('[data-testid="for-you-deck"] [data-testid="role-stack"] [data-testid="role-stack-card"][data-stack-pose="front"]');
  await expect(front).toHaveAttribute("data-job-id", staff.id, { timeout: 60_000 });
  expect(marks.length).toBeGreaterThan(0);
  expect(marks.every((m) => m.omitPastSenior === undefined), "no leave-out flag for a Staff résumé").toBe(true);
  expect(diagnostics.pageErrors).toEqual([]);
});


/**
 * J-JOBS-131 — Vivek, 2026-10-14: "the recommendations are still garbage and the product is still unusable".
 * A For you pack is not a search: it lists only roles the résumé could take, and says how many it left out and why.
 */
const FRENCH_ASK =
  "You are fluent in French and English. You will own technical onboarding for enterprise accounts and run quarterly reviews with customers. We are a growing company with a friendly team.";
/** The years only in the text (the listing's structured field is missing on about half the postings): 15+ against the résumé's seven in the line. */
const YEARS_ASK =
  "What you bring:\n15+ years of relevant experience\nStrong communication. You will own technical onboarding for enterprise accounts and run quarterly reviews with customers. We are a growing company with a friendly team.";

test("a pack lists only roles the résumé could take, and says how many it left out and why", { tag: ["@J-JOBS-131"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  await seedResume(page);
  const own = posting("66666666-0000-4000-8000-000000000001", "Technical Account Manager", "Northstar Data", "senior", 2);
  const csm = posting("66666666-0000-4000-8000-000000000002", "Customer Success Manager", "Orchard CRM", "mid", 3);
  const french = { ...posting("66666666-0000-4000-8000-000000000003", "Technical Account Manager", "Maison Nord", "senior", 2), description: FRENCH_ASK };
  const pm = posting("66666666-0000-4000-8000-000000000004", "Product Manager", "Fernway", "mid", 2);
  const junior = posting("66666666-0000-4000-8000-000000000005", "Junior Technical Account Manager", "Harbor Pay", "mid", 2);
  const staff = posting("66666666-0000-4000-8000-000000000006", "Staff Technical Account Manager", "Juniper Labs", "senior", 1);
  const veteran = { ...posting("66666666-0000-4000-8000-000000000007", "Technical Account Manager", "Old Harbour", "senior", 2), description: YEARS_ASK };
  await withAccountApplications(page, []);
  await answerResumeSearch(page, [french, pm, junior, staff, veteran, own, csm], "journey-left-out");
  await openPack(page);

  // Two of the seven fit: the own role and a customer success role. The rest are not in the deck.
  const stack = page.locator('[data-testid="for-you-deck"] [data-testid="role-stack"]');
  await expect(page.getByTestId("for-you-deck-position")).toHaveText("Role 1 of 2", { timeout: 60_000 });
  for (const gone of [french, pm, junior, staff, veteran]) {
    await expect(stack.locator(`[data-testid="role-stack-card"][data-job-id="${gone.id}"]`)).toHaveCount(0);
  }

  // At the foot of the deck: what fits, and what was left out and why.
  await page.getByTestId("for-you-next").click();
  await expect(page.getByTestId("for-you-showing-total")).toHaveText("2 roles fit your résumé · best fit first");
  await expect(page.getByTestId("for-you-left-out")).toHaveText(
    "Left out of the 7 roles found: 2 above your level · 2 asking for something your résumé doesn't show · 1 a different kind of role",
  );
  expect(diagnostics.pageErrors).toEqual([]);
});

test("a pack with no role the résumé could take says so and why, instead of a generic empty list", { tag: ["@J-JOBS-131"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  await seedResume(page);
  const french = { ...posting("77777777-0000-4000-8000-000000000001", "Technical Account Manager", "Maison Nord", "senior", 2), description: FRENCH_ASK };
  const staff = posting("77777777-0000-4000-8000-000000000002", "Staff Technical Account Manager", "Juniper Labs", "senior", 1);
  await withAccountApplications(page, []);
  await answerResumeSearch(page, [french, staff], "journey-none-fit");
  await openPack(page);

  await expect(page.getByTestId("for-you-empty")).toContainText("None of the roles we found fit your résumé yet.", { timeout: 60_000 });
  await expect(page.getByTestId("for-you-empty")).toContainText("Left out of the 2 roles found: 1 above your level · 1 asking for something your résumé doesn't show");
  expect(diagnostics.pageErrors).toEqual([]);
});

/**
 * J-JOBS-132 — Vivek, 2026-10-14: "FIRST MATCH the rest of the experience and skills content to the job profiles
 * and then match the title if necessary AT THE END"; 2026-10-15: "that is how people find adjacent roles or titles
 * that they haven't heard of but are very well qualified for". A pack lists a role whose title the résumé never
 * names when its posting asks for what the résumé shows, and puts it ahead of a posting that is only its title;
 * a remote role that names no country is listed last, as Country unclear.
 * The postings are CONSTRUCTED for this journey (no real company or posting).
 */
const askingForTheResumeWork = (company: string, title: string) => [
  `About the role\n${company} is hiring a ${title}.`,
  "What you'll do\nOwn the adoption and renewal plan for enterprise accounts. Handle technical escalations and API integration issues with engineering, work with product managers on the roadmap, and report on customer health and usage with SQL and Salesforce. Lead onboarding and quarterly business reviews for strategic enterprise customers.",
  "What you bring\n6+ years of experience\nExperience with REST APIs\nExperience with Salesforce\nExperience with SQL\nExperience with enterprise customers",
].join("\n\n");
const GENERIC_DESCRIPTION =
  "About the role\nNorthstar Data is hiring a Technical Account Manager.\n\nWhat you'll do\nWe are looking for a Technical Account Manager to join our team. You will work with a variety of stakeholders and grow with a fast-moving company.";

const described = (job: ReturnType<typeof posting>, description: string) => ({ ...job, description, jd_terms: jdTermsFromDescription(description, job as never) });

test("a pack lists a title the résumé never names when its posting asks for what the résumé shows, ahead of a posting that is only its title, and a remote role with no country last", { tag: ["@J-JOBS-132"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  await seedResume(page);
  const led = described(posting("88888888-0000-4000-8000-000000000001", "Customer Delivery Lead, API Programs", "Orchard CRM", "senior", 3), askingForTheResumeWork("Orchard CRM", "Customer Delivery Lead, API Programs"));
  const generic = described(posting("88888888-0000-4000-8000-000000000002", "Technical Account Manager", "Northstar Data", "senior", 2), GENERIC_DESCRIPTION);
  const noCountry = described(
    { ...posting("88888888-0000-4000-8000-000000000003", "Technical Account Manager", "Fernway", "senior", 1), location: "Remote", location_city: null, location_state: null, location_country: null, work_type: "remote" } as never,
    askingForTheResumeWork("Fernway", "Technical Account Manager"),
  );
  await withAccountApplications(page, []);
  // Sent generic first, as a search that matches on title would: the deck puts the posting that asks for the résumé's work ahead of it.
  const sent: { contentPhrases?: string[]; unplacedRemote?: boolean }[] = [];
  await page.route("**/*", async (route) => {
    const req = route.request();
    const body = req.postData() ?? "";
    if (!isListSearch(req) || !body.includes('"withFacets":true') || !body.includes('"offset":0')) return route.fallback();
    const parsed = JSON.parse(body) as { fromResume?: boolean; contentPhrases?: string[]; unplacedRemote?: boolean };
    if (parsed.fromResume) sent.push({ contentPhrases: parsed.contentPhrases, unplacedRemote: parsed.unplacedRemote });
    const hits = [generic, noCountry, led];
    return answerListSearch(route, { hits, total: hits.length, backend: "meilisearch", configured: true, searchId: "journey-content-first" });
  });
  await openPack(page);

  const front = page.locator('[data-testid="for-you-deck"] [data-testid="role-stack"] [data-testid="role-stack-card"][data-stack-pose="front"]');
  await expect(page.getByTestId("for-you-deck-position")).toHaveText("Role 1 of 3", { timeout: 60_000 });
  await expect(front).toHaveAttribute("data-job-id", led.id);
  await expect(page.getByTestId("match-chip")).toHaveText("Strong");

  await page.getByTestId("for-you-next").click();
  await expect(front).toHaveAttribute("data-job-id", generic.id);

  await page.getByTestId("for-you-next").click();
  await expect(front).toHaveAttribute("data-job-id", noCountry.id);
  await expect(page.getByTestId("match-chip")).toHaveText("Country unclear");

  // The pack's search asked for postings by what they say, with a few skill phrases and no name or contact detail.
  const asked = sent.find((m) => (m.contentPhrases?.length ?? 0) > 0);
  expect(asked, "a résumé-built search carries content phrases").toBeTruthy();
  const lanes = asked!.contentPhrases!;
  const singles = lanes.filter((phrase) => !phrase.includes(" "));
  expect(lanes.length - singles.length, "at most four two-word duty phrases").toBeLessThanOrEqual(4);
  expect(singles.length, "at most three single skill words").toBeLessThanOrEqual(3);
  // A single word is one the résumé LISTS as a skill (never a word from its prose, a name or a place).
  const skillWords = new Set(["customer", "success", "product", "management", "sql", "rest", "apis", "salesforce"]);
  for (const word of singles) expect(skillWords.has(word), `"${word}" is not a word of the résumé's skills list`).toBe(true);
  expect(asked!.unplacedRemote).toBe(true);
  expect(JSON.stringify(asked!.contentPhrases).toLowerCase()).not.toMatch(/\bmorgan\b|\blee\b|example\.com|555-010/);
  expect(diagnostics.pageErrors).toEqual([]);
});

/**
 * J-JOBS-133 / J-JOBS-134 — the gate, 2026-10-15: J-JOBS-100, 50, 52 and 80 failed at the staging head because a pack
 * and Today held no roles for their fixture résumé (a short one: five skills, two jobs). Nearly every posting lists
 * tools or requirements such a résumé cannot "show", and the deck left each one out. A list the résumé does not answer
 * is a ranking signal, not a reason to leave the role out (a short résumé is not judged by it at all); an explicit ask
 * the résumé does not show (a language, a clearance, years, managing, selling, a certification) still takes a role out
 * (J-JOBS-131); and a pack where nothing fits shows the closest roles under an honest line, not an empty list.
 * The postings are CONSTRUCTED for these journeys (no real company or posting).
 */
const listingTools = (company: string, tools: string[]) =>
  [
    `About the role\n${company} is hiring a Technical Account Manager.`,
    "What you'll do\nOwn the adoption and renewal plan for enterprise accounts and run technical escalations with engineering.",
    `What you bring\n6+ years of experience\n${tools.map((tool) => `Experience with ${tool}`).join("\n")}`,
  ].join("\n\n");

test("a short résumé's pack still lists roles in its own line whose postings list tools the résumé does not show", { tag: ["@J-JOBS-133"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  await seedResume(page);
  const tools = ["Gainsight", "Snowflake", "Looker", "Tableau", "Zendesk"];
  const withTools = (id: string, company: string, daysOld: number) =>
    described(posting(id, "Technical Account Manager", company, "senior", daysOld), listingTools(company, tools));
  const roles = [
    withTools("aaaaaaaa-0000-4000-8000-000000000001", "Orchard CRM", 1),
    withTools("aaaaaaaa-0000-4000-8000-000000000002", "Juniper Labs", 2),
    withTools("aaaaaaaa-0000-4000-8000-000000000003", "Fernway", 3),
  ];
  // The same listing asking for French: an explicit ask the résumé does not show, so it is still left out.
  const french = described(posting("aaaaaaaa-0000-4000-8000-000000000004", "Technical Account Manager", "Maison Nord", "senior", 1), `${listingTools("Maison Nord", tools)}\n\nYou are fluent in French and English.`);
  await withAccountApplications(page, []);
  await answerResumeSearch(page, [french, ...roles], "journey-short-resume");
  await openPack(page);

  const stack = page.locator('[data-testid="for-you-deck"] [data-testid="role-stack"]');
  await expect(page.getByTestId("for-you-deck-position")).toHaveText("Role 1 of 3", { timeout: 60_000 });
  await expect(stack.locator(`[data-testid="role-stack-card"][data-job-id="${french.id}"]`)).toHaveCount(0);
  await expect(page.getByTestId("for-you-near-notice")).toHaveCount(0);
  for (let step = 0; step < 2; step++) await page.getByTestId("for-you-next").click();
  await expect(page.getByTestId("for-you-showing-total")).toHaveText("3 roles fit your résumé · best fit first");
  await expect(page.getByTestId("for-you-left-out")).toHaveText("Left out of the 4 roles found: 1 asking for something your résumé doesn't show");
  expect(diagnostics.pageErrors).toEqual([]);
});

/** A résumé with enough lines (two hundred terms) to be judged against a posting's requirement list. */
const RICH_RESUME = {
  ...TAM_RESUME,
  experience: [
    { id: "exp1", company: "Northwind Cloud", role: "Technical Account Manager", dates: "2019 - Present", description: "Owned adoption, renewals and technical escalations for 40 enterprise accounts, worth 12 million in annual recurring revenue.\nLed quarterly business reviews with executive sponsors and translated customer feedback into roadmap proposals with product managers.\nBuilt onboarding playbooks, health scoring in SQL and Salesforce dashboards that cut churn among strategic accounts.\nTriaged API and integration incidents with engineering, wrote runbooks and trained support engineers on webhooks, OAuth and rate limits." },
    { id: "exp2", company: "Maple Systems", role: "Technical Support Engineer", dates: "2015 - 2019", description: "Resolved REST API, SSO and data migration issues for enterprise customers.\nReproduced defects, filed detailed bug reports and verified fixes in staging environments.\nAuthored knowledge base articles, mentored new hires and measured ticket backlog, response times and satisfaction scores." },
    { id: "exp3", company: "Lakeshore Software", role: "Implementation Consultant", dates: "2012 - 2015", description: "Configured and deployed workflow software for mid-market clients, ran training workshops and documented requirements, integrations and acceptance tests." },
  ],
  competencies: [
    { category: "Customer", skills: ["Customer Success", "Onboarding", "Renewals", "Escalation management", "Quarterly business reviews", "Stakeholder management"] },
    { category: "Technical", skills: ["SQL", "REST APIs", "Salesforce", "Zendesk", "Webhooks", "OAuth", "SSO", "Postman", "JIRA", "Confluence"] },
  ],
};

test("a pack where nothing fits lists the closest roles under an honest line, not an empty list", { tag: ["@J-JOBS-134"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  await seedResume(page, RICH_RESUME);
  // Titled like the résumé's own role, but asking for four things a TAM résumé does not show (constructed: a trades listing).
  const unrelated = (id: string, company: string, daysOld: number) =>
    described(
      posting(id, "Technical Account Manager", company, "senior", daysOld),
      [
        `About the role\n${company} is hiring a Technical Account Manager.`,
        "Requirements\n- Hands-on welding and brazing of structural steel\n- Operating a forklift and overhead crane safely\n- Pipefitting and boiler maintenance in plant settings\n- Erecting scaffolding to site safety standards",
      ].join("\n\n"),
    );
  const close = [unrelated("bbbbbbbb-0000-4000-8000-000000000001", "Steelhead Works", 1), unrelated("bbbbbbbb-0000-4000-8000-000000000002", "Ironbridge", 2)];
  const staff = posting("bbbbbbbb-0000-4000-8000-000000000003", "Staff Technical Account Manager", "Juniper Labs", "senior", 1);
  await withAccountApplications(page, []);
  await answerResumeSearch(page, [staff, ...close], "journey-closest");
  await openPack(page);

  await expect(page.getByTestId("for-you-near-notice")).toContainText("None of the roles we found fit your résumé well yet. These are the closest", { timeout: 60_000 });
  await expect(page.getByTestId("for-you-empty")).toHaveCount(0);
  await expect(page.getByTestId("for-you-deck-position")).toHaveText("Role 1 of 2");
  await expect(page.getByTestId("match-chip")).toHaveText("Stretch");
  await page.getByTestId("for-you-next").click();
  await expect(page.getByTestId("for-you-showing-total")).toHaveText("2 closest roles · each a weaker fit");
  await expect(page.getByTestId("for-you-left-out")).toHaveText("Left out of the 3 roles found: 1 above your level");
  expect(diagnostics.pageErrors).toEqual([]);
});

/**
 * J-JOBS-135 — coordinator, 2026-10-15 (Vivek: the lists recommend roles the others do not): every list that
 * recommends orders and leaves out the same way. The packs hub's tile counts the roles the deck lists (not the
 * roles the search found), and the fit-sorted Search list puts the same roles in the same order as the deck.
 * The postings are CONSTRUCTED for this journey (no real company or posting).
 */
test("the packs hub counts the roles the deck lists, and the fit-sorted Search list orders them as the deck does", { tag: ["@J-JOBS-135"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  await seedResume(page);
  const own = posting("99999999-0000-4000-8000-000000000001", "Technical Account Manager", "Northstar Data", "senior", 1);
  const csm = posting("99999999-0000-4000-8000-000000000002", "Senior Customer Success Manager", "Orchard CRM", "senior", 3);
  const old = posting("99999999-0000-4000-8000-000000000003", "Technical Account Manager", "Harbor Pay", "senior", 70);
  const nurse = posting("99999999-0000-4000-8000-000000000004", "Registered Nurse", "Lakeside Health", "mid", 1);
  await withAccountApplications(page, []);
  // Sent worst first, as a search that matches on words would: four roles found, two of them for this résumé.
  const found = [nurse, old, csm, own];
  await page.route("**/*", async (route) => {
    const req = route.request();
    if (!isListSearch(req)) return route.fallback();
    const parsed = JSON.parse(req.postData() ?? "{}") as { fromResume?: boolean; offset?: number };
    if (!parsed.fromResume || (parsed.offset ?? 0) !== 0) return route.fallback();
    return answerListSearch(route, { hits: found, total: found.length, backend: "meilisearch", configured: true, searchId: "journey-parity" });
  });

  // The hub's "All your matches" tile says 2 (the roles the deck lists), not the 4 the search found.
  await page.goto("/jobs?view=for-you");
  await expect(page.getByTestId("hub-pack-count-all")).toHaveText("2", { timeout: 60_000 });
  await openPack(page);

  const front = page.locator('[data-testid="for-you-deck"] [data-testid="role-stack"] [data-testid="role-stack-card"][data-stack-pose="front"]');
  await expect(page.getByTestId("for-you-deck-position")).toHaveText("Role 1 of 2", { timeout: 60_000 });
  const deckOrder = [await front.getAttribute("data-job-id")];
  await page.getByTestId("for-you-next").click();
  await expect(page.getByTestId("for-you-deck-position")).toHaveText("Role 2 of 2");
  deckOrder.push(await front.getAttribute("data-job-id"));
  expect([...deckOrder].sort()).toEqual([own.id, csm.id].sort());
  await expect(page.getByTestId("for-you-left-out")).toContainText("Left out of the 4 roles found");

  // The fit-sorted Search list: the same two roles first, in the deck's order; the ones the deck leaves out follow.
  await page.goto("/jobs?view=search&sort=fit");
  await expect(page.getByTestId("job-row")).toHaveCount(4, { timeout: 60_000 });
  await expect.poll(async () => (await rowIds(page)).slice(0, 2), { timeout: 30_000 }).toEqual(deckOrder);
  expect(diagnostics.pageErrors).toEqual([]);
});

/**
 * J-JOBS-136 — Vivek, 2026-10-14/15: "FIRST MATCH the rest of the experience and skills content to the job profiles
 * and then match the title if necessary AT THE END"; "that is how people find adjacent roles or titles that they
 * haven't heard of". A posting whose title is another line of work's (a Software Engineer for a Technical Account
 * Manager) is listed, and leads a posting that is only the résumé's own title, when it asks for the work the résumé
 * shows and for skills the résumé lists; one that only shares some words stays out as a different kind of role.
 * The postings are CONSTRUCTED for this journey (no real company or posting).
 */
test("a pack lists another line of work's title when its posting asks for what the résumé shows, and leaves out one that only shares some words", { tag: ["@J-JOBS-136"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  await seedResume(page);
  const withSkills = <T extends object>(job: T, skills: string[]) => ({ ...job, must_have_skills: skills, skills_section_found: true });
  const asked = described(
    withSkills(posting("cccccccc-0000-4000-8000-000000000001", "Software Engineer, Customer Integrations", "Orchard CRM", "senior", 3), ["REST APIs", "Salesforce", "SQL", "Enterprise customers"]) as never,
    askingForTheResumeWork("Orchard CRM", "Software Engineer, Customer Integrations"),
  );
  const generic = described(posting("cccccccc-0000-4000-8000-000000000002", "Technical Account Manager", "Northstar Data", "senior", 2), GENERIC_DESCRIPTION);
  const engineering = described(
    withSkills(posting("cccccccc-0000-4000-8000-000000000003", "Backend Engineer, Data Pipelines", "Fernway", "senior", 1), ["Go", "Kubernetes", "Postgres", "Kafka"]) as never,
    [
      "About the role\nFernway is hiring a Backend Engineer, Data Pipelines.",
      "What you'll do\nBuild and operate streaming data pipelines in Go on Kubernetes with Postgres and Kafka. Own services end to end, join the on-call rotation and improve observability.",
      "What you bring\n5+ years of experience\nExperience with Go\nExperience with Kubernetes\nExperience with Postgres\nExperience with Kafka",
    ].join("\n\n"),
  );
  await withAccountApplications(page, []);
  // Sent title-first, as a search that matches on words would.
  await answerResumeSearch(page, [generic, engineering, asked], "journey-title-last");
  await openPack(page);

  const front = page.locator('[data-testid="for-you-deck"] [data-testid="role-stack"] [data-testid="role-stack-card"][data-stack-pose="front"]');
  await expect(page.getByTestId("for-you-deck-position")).toHaveText("Role 1 of 2", { timeout: 60_000 });
  await expect(front).toHaveAttribute("data-job-id", asked.id);
  await expect(page.getByTestId("match-chip")).toHaveText("Strong");
  await page.getByTestId("for-you-next").click();
  await expect(front).toHaveAttribute("data-job-id", generic.id);
  await expect(page.getByTestId("for-you-showing-total")).toHaveText("2 roles fit your résumé · best fit first");
  await expect(page.getByTestId("for-you-left-out")).toHaveText("Left out of the 3 roles found: 1 a different kind of role");
  expect(diagnostics.pageErrors).toEqual([]);
});

/**
 * J-JOBS-137 — the reason on a pack's role (the hover on its label, the line in the daily picks email and the MCP
 * `why`) says what the posting asks for that the résumé shows, not only the title, place and level.
 * The posting is CONSTRUCTED for this journey (no real company or posting).
 */
test("the reason on a role names what its posting asks for that the résumé shows", { tag: ["@J-JOBS-137"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  await seedResume(page);
  const own = described(posting("dddddddd-0000-4000-8000-000000000001", "Technical Account Manager", "Orchard CRM", "senior", 2), askingForTheResumeWork("Orchard CRM", "Technical Account Manager"));
  await withAccountApplications(page, []);
  await answerResumeSearch(page, [own], "journey-reason-terms");
  await openPack(page);

  const front = page.locator('[data-testid="for-you-deck"] [data-testid="role-stack"] [data-testid="role-stack-card"][data-stack-pose="front"]');
  await expect(front).toHaveAttribute("data-job-id", own.id, { timeout: 60_000 });
  const chip = page.getByTestId("match-chip");
  await expect(chip).toHaveText("Strong");
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
  await expect(reason).toContainText("It's your own role: the title matches Technical Account Manager on your résumé.");
  // Two or three of the posting's own terms (never its title's words), then the place and level.
  await expect(reason).toHaveText(/The posting asks for [a-z+#. ,]+, which your résumé shows\. It's in your country/);
  expect(diagnostics.pageErrors).toEqual([]);
});

/**
 * J-JOBS-138 — Vivek, 2026-10-15: SecOps Engineer, Senior Salesforce Administrator and Application Support Analyst read
 * Strong on his Today list under a Product Manager résumé. A title the résumé has not held reads Strong only when the
 * day-to-day work its posting describes (its responsibilities) shows on the résumé; a requirements list that shares the
 * résumé's tools (REST APIs, Salesforce, SQL) is not the work. The postings are CONSTRUCTED for this journey (no real
 * company or posting).
 */
const sharingOnlyTheTools = (company: string, title: string) =>
  [
    `About the role\n${company} is hiring a ${title}.`,
    "What you'll do\n\nMonitor and triage security alerts in the SIEM, hunt threats with endpoint detection tooling, run vulnerability scans and track remediation, administer Defender and Sentinel, and harden cloud configurations.",
    "What you bring\n\n6+ years of experience\nExperience with REST APIs\nExperience with Salesforce\nExperience with SQL\nExperience with enterprise customers\nExperience with customer success reporting\nExperience with technical escalations\nExperience with product management",
  ].join("\n\n");

test("a title the résumé has not held reads Strong when its day-to-day work shows on the résumé, and Good when only its requirements list shares the résumé's tools", { tag: ["@J-JOBS-138"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  await seedResume(page);
  const led = described(posting("99999999-0000-4000-8000-000000000001", "Customer Delivery Lead, API Programs", "Orchard CRM", "senior", 3), askingForTheResumeWork("Orchard CRM", "Customer Delivery Lead, API Programs"));
  const tools = described(posting("99999999-0000-4000-8000-000000000002", "SecOps Engineer", "Alcumus", "senior", 1), sharingOnlyTheTools("Alcumus", "SecOps Engineer"));
  // Live descriptions often arrive as one run of text with no heading we read (Alcumus, Loopio, Risk Control, eBay on 2026-10-15): the same
  // work as the first posting's, under a title the résumé has not held. Its whole text is not evidence of the work, so it reads Good.
  const flatTitle = "Delivery Operations Lead, API Programs";
  const flat = described(
    posting("99999999-0000-4000-8000-000000000003", flatTitle, "Fernway", "senior", 2),
    askingForTheResumeWork("Fernway", flatTitle).split("\n\n").flatMap((part) => part.split("\n").slice(1)).join(" "),
  );
  await withAccountApplications(page, []);
  // Sent the tools-only and the flat postings first, as a search that matches on words would: the deck puts the one whose work is the résumé's ahead of them.
  await answerResumeSearch(page, [tools, flat, led], "journey-duty-led");
  await openPack(page);

  const front = page.locator('[data-testid="for-you-deck"] [data-testid="role-stack"] [data-testid="role-stack-card"][data-stack-pose="front"]');
  await expect(page.getByTestId("for-you-deck-position")).toHaveText("Role 1 of 3", { timeout: 60_000 });
  await expect(front).toHaveAttribute("data-job-id", led.id);
  await expect(page.getByTestId("match-chip")).toHaveText("Strong");
  for (const position of [2, 3]) {
    await page.getByTestId("for-you-next").click();
    await expect(page.getByTestId("for-you-deck-position")).toHaveText(`Role ${position} of 3`);
    expect([tools.id, flat.id]).toContain(await front.getAttribute("data-job-id"));
    await expect(page.getByTestId("match-chip")).toHaveText("Good");
  }
  expect(diagnostics.pageErrors).toEqual([]);
});

/**
 * J-JOBS-139 — Vivek, 2026-10-15: his Today list read "Tuned away from Product Manager and Remote" and led with roles he
 * had not held, because his thumbs-downs on Product Manager roles moved those below them. A thumbs-down or thumbs-up
 * moves roles only inside their fit band and never puts a role the résumé has not held ahead of one it has; and the
 * tuning line never names a work mode or a place ("Remote") as the kind of role. The postings are CONSTRUCTED for this
 * journey (no real company or posting).
 */
const WORK_MODE_PACK = [
  posting("88888888-0000-4000-8000-000000000001", "Technical Account Manager", "Northstar Data", "senior"),
  { ...posting("88888888-0000-4000-8000-000000000002", "Remote Senior Customer Success Manager", "Orchard CRM", "senior"), tags: ["Remote"] },
  posting("88888888-0000-4000-8000-000000000003", "Senior Customer Success Manager", "Juniper Labs", "senior"),
  posting("88888888-0000-4000-8000-000000000004", "Solutions Engineer", "Orchard CRM", "senior"),
  posting("88888888-0000-4000-8000-000000000005", "Technical Support Manager", "Fernway", "senior"),
  posting("88888888-0000-4000-8000-000000000006", "Technical Support Manager", "Kestrel IO", "senior"),
];
const [, REMOTE_CSM, OTHER_CSM] = WORK_MODE_PACK.map((p) => p.id);

signedInTest("fewer like this on a role the résumé holds keeps the résumé's other such roles ahead of ones it has not held, and the tuning line never names Remote", { tag: ["@J-JOBS-139"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  await seedResume(page);
  await answerResumeSearch(page, WORK_MODE_PACK, "journey-tune-band");
  await openPack(page);

  const stack = page.locator('[data-testid="for-you-deck"] [data-testid="role-stack"]');
  const front = stack.locator('[data-testid="role-stack-card"][data-stack-pose="front"]');
  const position = page.getByTestId("for-you-deck-position");
  const tuned = page.getByTestId("deck-tuning");

  await expect(position).toHaveText("Role 1 of 6", { timeout: 60_000 });
  await page.getByTestId("for-you-next").click();
  await expect(position).toHaveText("Role 2 of 6");
  const tapped = (await front.getAttribute("data-job-id")) ?? "";
  expect([REMOTE_CSM, OTHER_CSM]).toContain(tapped);

  // Fewer like this on one customer success role: it goes, and the other one is next, ahead of the
  // Solutions Engineer and Technical Support Manager roles the résumé has not held.
  await front.getByTestId("role-fewer-like-this").click();
  await expect(position).toHaveText("Role 2 of 5");
  await expect(tuned).toContainText("Tuned away from ");
  await expect(tuned).not.toContainText(/remote/i);
  await expect(front).toHaveAttribute("data-job-id", tapped === REMOTE_CSM ? OTHER_CSM : REMOTE_CSM);
  expect(withoutMockSignInHydration(diagnostics.pageErrors)).toEqual([]);
});

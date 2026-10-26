import type { Page } from "@playwright/test";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { LOCAL_AI_RESUME_KEY } from "../../../src/lib/local-ai/resume-storage";
import { COMMERCIAL_FINANCE_TEXT, SOCIAL_SERVICES_TEXT, SUPPLY_CHAIN_TEXT } from "../../fixtures/job-descriptions/content-family-postings";
import { FRENCH_ACCOUNT_TEXT } from "../../fixtures/job-descriptions/other-language-postings";
import { jdTermsFromDescription } from "../../../src/lib/match/jd-match";
import { expect, test } from "./fixtures";
import { answerListSearch, isListSearch } from "./list-search";
import { signInLikeProduction, withActionResult, withoutMockSignInHydration } from "./signed-in";

/**
 * Personalised matching fixes, review 2026-10-13 — see tests/journeys/CATALOG.md (J-JOBS-121 to 155). The list ranked against the
 * résumé is the one list that recommends (the For you deck and Today it replaced are gone): these hold its rules.
 * Read-only: the résumé and the guest tracker live in localStorage, and the list search's answer
 * is replaced in the browser (the search still runs), as in match-order.spec.ts.
 *
 * - J-JOBS-121 / J-JOBS-126 "The jobs I have applied to keep coming back and there is no badge":
 *   the corpus re-lists the same opening under a new id, and no list row said a role was applied
 *   to. Applying needs an account (a guest's Apply opens "Sign in to apply", J-APPLY-01), so these
 *   run signed in, with the account's tracker answered in the browser.
 * - J-JOBS-122 "returning recent jobs instead of jobs from 1 month ago": among roles that fit
 *   alike, the newest leads; a role over two weeks old ranks after this week's.
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

const rowIds = (page: Page) => page.getByTestId("job-row").evaluateAll((els) => els.map((el) => el.getAttribute("data-job-id")));

/**
 * The account's tracker, answered in the browser: `getApplications` (the one server action that
 * lists it) is told apart from the other list actions by the id the page's own bundle gives it —
 * `createServerReference("<id>", …, "getApplications")`, in dev and production builds alike.
 * Signed in the way production is (`signInLikeProduction`); every other action keeps its answer.
 *
 * `postedDateSupported` also answers `getPostedDateFilterSupportAction` (its server-side probe reads the search index,
 * which a dev server with no search backend does not have, so it says "no" and the deck drops its date window). Production
 * answers "yes", so a journey that holds a deck to a date window (the "Added this week" tile) sets it.
 */
async function withAccountApplications(page: Page, applications: object[], opts: { postedDateSupported?: boolean } = {}) {
  let actionId: string | null = null;
  let postedActionId: string | null = null;
  await page.route(/\/_next\/static\/chunks\/.*\.js(\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    const found = body.match(/\("([0-9a-f]{40,44})",[^)]{0,1500}?"getApplications"\)/);
    if (found) actionId = found[1]!;
    const posted = body.match(/\("([0-9a-f]{40,44})",[^)]{0,1500}?"getPostedDateFilterSupportAction"\)/);
    if (posted) postedActionId = posted[1]!;
    return route.fulfill({ response, body });
  });
  await signInLikeProduction(page, () => undefined);
  await page.route(
    () => true,
    async (route) => {
      const req = route.request();
      const action = req.headers()["next-action"];
      if (req.method() !== "POST" || !action) return route.fallback();
      if (actionId && action === actionId) {
        const res = await route.fetch();
        return route.fulfill({ response: res, body: withActionResult(await res.text(), { data: applications }) });
      }
      if (opts.postedDateSupported !== undefined && postedActionId && action === postedActionId) {
        const res = await route.fetch();
        return route.fulfill({ response: res, body: withActionResult(await res.text(), opts.postedDateSupported) });
      }
      return route.fallback();
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

test("a role the account applied to is badged Applied in a search, also when the same opening is listed again under a new id", { tag: ["@J-JOBS-121"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await seedResume(page);
  const applicationsActionId = await withAccountApplications(page, [NORTHSTAR_APPLICATION]);
  await answerResumeSearch(page, [RELISTED, OTHER_TAM], "journey-applied");
  await page.goto("/jobs?q=technical+account+manager");
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
  await page.goto("/jobs?sort=fit");

  await expect(page.getByTestId("job-row")).toHaveCount(3, { timeout: 60_000 });
  await expect.poll(() => rowIds(page), { timeout: 30_000 }).toEqual([thisWeek.id, lastWeek.id, old.id]);
  expect(diagnostics.pageErrors).toEqual([]);
});

/** Open /jobs for an account with a résumé on file: it opens on the list ranked against the résumé. */
async function openFitList(page: Page) {
  await page.goto("/jobs");
  await expect(page.getByTestId("result-line")).toBeVisible({ timeout: 60_000 });
}

/** The list's row for one role (an employer's other roles ride inside its row, not as rows of their own). */
const listRow = (page: Page, id: string) => page.locator(`[data-testid="job-row"][data-job-id="${id}"]`);

/** As ranked for the TAM résumé: its own role, two customer success roles, then the rest. */
const PACK = [
  posting("77777777-0000-4000-8000-000000000001", "Technical Account Manager", "Northstar Data", "senior"),
  posting("77777777-0000-4000-8000-000000000002", "Senior Customer Success Manager", "Orchard CRM", "senior"),
  posting("77777777-0000-4000-8000-000000000003", "Senior Customer Success Manager", "Juniper Labs", "senior"),
  posting("77777777-0000-4000-8000-000000000004", "Solutions Engineer", "Orchard CRM", "senior"),
  posting("77777777-0000-4000-8000-000000000005", "Technical Support Manager", "Fernway", "senior"),
  posting("77777777-0000-4000-8000-000000000006", "Technical Support Manager", "Kestrel IO", "senior"),
];

test("the list never lists a role the account applied to, nor the same opening listed again under a new id", { tag: ["@J-JOBS-126"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await seedResume(page);
  await withAccountApplications(page, [NORTHSTAR_APPLICATION]);
  const csm = posting("55555555-0000-4000-8000-000000000003", "Senior Customer Success Manager", "Orchard CRM", "senior");
  await answerResumeSearch(page, [RELISTED, OTHER_TAM, csm], "journey-pack-applied");
  await openFitList(page);

  // The two roles not applied to make the list, in fit order; the applied Northstar opening is not in it at all.
  await expect(page.getByTestId("job-row")).toHaveCount(2, { timeout: 60_000 });
  await expect(listRow(page, RELISTED.id)).toHaveCount(0);
  expect((await rowIds(page)).sort()).toEqual([OTHER_TAM.id, csm.id].sort());
  expect(diagnostics.pageErrors).toEqual([]);
});

test("the list holds only roles from the last 30 days, with their age on the row, and leaves out older ones, also one an employer re-dated", { tag: ["@J-JOBS-127"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await seedResume(page);
  // Sent own-title first, the order the role tier alone gave them (live TAM list, 2026-10-13).
  const ancient = posting("88888888-0000-4000-8000-000000000001", "Technical Account Manager", "Braze Cloud", "senior", 85);
  const stale = posting("88888888-0000-4000-8000-000000000002", "Technical Account Manager", "Docent Labs", "senior", 45);
  const fresh = posting("88888888-0000-4000-8000-000000000003", "Senior Customer Success Manager", "Maple CRM", "senior", 3);
  const lastMonth = posting("88888888-0000-4000-8000-000000000004", "Technical Account Manager", "Quill Systems", "senior", 25);
  // Dated yesterday, but first seen 45 days ago: the employer moved the date forward on an old requisition (2026-10-16).
  const redated = { ...posting("88888888-0000-4000-8000-000000000005", "Technical Account Manager", "Sable Cloud", "senior", 1), first_seen_at: new Date(Date.now() - 45 * DAY_MS).toISOString() };
  await withAccountApplications(page, []);
  await answerResumeSearch(page, [ancient, stale, redated, fresh, lastMonth], "journey-pack-age");
  await openFitList(page);

  await expect(page.getByTestId("job-row")).toHaveCount(2, { timeout: 60_000 });
  await expect.poll(() => rowIds(page)).toEqual([fresh.id, lastMonth.id]);
  await expect(listRow(page, fresh.id).getByTestId("posted-age")).toContainText("3d");
  await expect(listRow(page, lastMonth.id).getByTestId("posted-age")).toContainText("25d");
  for (const gone of [ancient, stale, redated]) await expect(listRow(page, gone.id)).toHaveCount(0);
  await expect(page.getByTestId("list-left-out")).toHaveText("Left out of the 5 roles found: 3 posted over 30 days ago");
  expect(diagnostics.pageErrors).toEqual([]);
});

// J-JOBS-144 — Vivek, 2026-10-16: "the for you is still showing up really old jobs from more than 30 days ago". A list
// never empties for age alone: when no role from the last 30 days fits, the roles that fit and are older stand in,
// under a line that says so, each row with its age.
test("when no role from the last 30 days fits, the list holds the older roles that fit under an honest line, each with its age", { tag: ["@J-JOBS-144"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await seedResume(page);
  const older = posting("99999999-0000-4000-8000-000000000001", "Technical Account Manager", "Docent Labs", "senior", 40);
  const oldest = posting("99999999-0000-4000-8000-000000000002", "Technical Account Manager", "Braze Cloud", "senior", 70);
  await withAccountApplications(page, []);
  await answerResumeSearch(page, [oldest, older], "journey-pack-older");
  await openFitList(page);

  await expect(page.getByTestId("list-notice")).toContainText("each card shows its age", { timeout: 60_000 });
  await expect(page.getByTestId("list-none-fit")).toHaveCount(0);
  await expect(page.getByTestId("job-row")).toHaveCount(2);
  // The row's age is the list's own, in months once a posting is a month old.
  await expect(listRow(page, older.id).getByTestId("posted-age")).toHaveText("1mo ago");
  await expect(listRow(page, oldest.id).getByTestId("posted-age")).toHaveText("2mo ago");
  await expect(page.getByTestId("result-line")).toHaveText("2 roles · ranked by fit");
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

// fixme(wave3-h): Replace left the /jobs toolbar for the one "Ranked by your résumé · … · Edit" strip; re-point at Edit -> /resume.
test.fixme("replacing the résumé refreshes the list at once, with no reload: a TAM's list becomes a nurse's", { tag: ["@J-JOBS-128"] }, async ({ page, diagnostics }) => {
  // Vivek, 2026-10-13: "every time I upload a new resume the recommendations do not auto refresh".
  await returningVisitor(page);
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

  await openFitList(page);
  await expect(listRow(page, tam.id)).toBeVisible({ timeout: 60_000 });
  // A reload would drop this mark.
  await page.evaluate(() => { (window as unknown as { __sameDocument?: boolean }).__sameDocument = true; });

  await page.getByTestId("jobs-replace-resume").click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[type="file"]').setInputFiles({ name: "jordan.txt", mimeType: "text/plain", buffer: Buffer.from(NURSE_RESUME_TEXT) });
  await dialog.getByTestId("resume-import-parse-primary").click();
  const confirm = dialog.locator('[data-slot="dialog-footer"]').getByRole("button").last();
  await expect(confirm).toBeEnabled({ timeout: 15_000 });
  await confirm.click();

  // The list is ranked again from the new résumé, in place.
  await expect(listRow(page, nurse.id)).toBeVisible({ timeout: 60_000 });
  await expect(listRow(page, tam.id)).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument), "no page reload").toBe(true);
  expect(diagnostics.pageErrors).toEqual([]);
});

test("the list reaches a month of roles: it asks for 300 résumé-ranked rows, not the newest 60", { tag: ["@J-JOBS-129"] }, async ({ page, diagnostics }) => {
  // Vivek, 2026-10-13: the index orders a broad role query newest first, so 60 rows held only ~2 weeks
  // of PM roles and missed Thumbtack's 29-day-old PM, Growth, which other portals recommended.
  // 2026-10-17: 150 read 150 of a 226-role search; the list now reads 300 (J-JOBS-151).
  await returningVisitor(page);
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
  await openFitList(page);
  await expect.poll(() => Math.max(0, ...limits), { timeout: 30_000 }).toBe(300);
  expect(diagnostics.pageErrors).toEqual([]);
});

/**
 * J-JOBS-151 — Vivek, 2026-10-17: "why are the matches so thin...just 14 roles?" His search found 226 roles and
 * the lists read the first 150; the 76 they never scored were mostly his own kind of role. Now they read 300. The
 * search here found 226 roles (answered in the browser by the rows each request asks for): Technical Account Manager
 * roles at places 11, 161 and 200, the rest a different kind of role. All three are listed, and the left-out line counts
 * all 226. The postings are CONSTRUCTED for this journey (no real company or posting).
 */
test("the list reads every role its search found up to 300: roles found past the first 150 are counted and listed", { tag: ["@J-JOBS-151"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await seedResume(page);
  const found = Array.from({ length: 226 }, (_, i) =>
    // One employer each, so no two are the same opening listed twice (`clusterJobs`) and the list reads all 226.
    posting(`bbbbbbbb-0000-4000-8000-${String(i).padStart(12, "0")}`, "Registered Nurse", `Lakeside Health ${i}`, "mid", 2),
  );
  const fits = { 10: "Fernway", 160: "Beacon Cloud", 199: "Kestrel IO" } as Record<number, string>;
  for (const [at, company] of Object.entries(fits)) found[Number(at)] = posting(`bbbbbbbb-1111-4000-8000-${String(at).padStart(12, "0")}`, "Technical Account Manager", company, "senior", 3);
  const limits: number[] = [];
  await withAccountApplications(page, []);
  await page.route("**/*", async (route) => {
    const req = route.request();
    if (!isListSearch(req)) return route.fallback();
    const parsed = JSON.parse(req.postData() ?? "{}") as { fromResume?: boolean; offset?: number; limit?: number };
    if (!parsed.fromResume || (parsed.offset ?? 0) !== 0) return route.fallback();
    limits.push(parsed.limit ?? 0);
    const hits = found.slice(0, parsed.limit ?? 20);
    return answerListSearch(route, { hits, total: found.length, backend: "meilisearch", configured: true, searchId: "journey-read-depth" });
  });

  await openFitList(page);
  await expect(page.getByTestId("result-line")).toHaveText("3 roles fit your résumé · best fit first", { timeout: 90_000 });
  await expect(page.getByTestId("list-left-out")).toContainText("Left out of the 226 roles found:");
  await expect(page.getByTestId("list-left-out")).not.toContainText("first");
  expect(Math.max(...limits), "the list's last read asks for 300").toBe(300);
  await expect(page.getByTestId("job-row")).toHaveCount(3);
  expect((await rowIds(page)).sort()).toEqual(Object.keys(fits).map((at) => `bbbbbbbb-1111-4000-8000-${at.padStart(12, "0")}`).sort());
  expect(diagnostics.pageErrors).toEqual([]);
});

/**
 * J-JOBS-152 — 2026-10-17, from the outside analysis Vivek sent ("Ten lead-level PM roles are never retrieved, even though
 * scoring would accept them"): a role listed Lead reads senior and fits a senior résumé, but the search asked for
 * mid and senior listings only. Now it asks for every listing level that reads as the résumé's (mid, senior and Lead), and
 * the Lead role is listed. The postings are CONSTRUCTED for this journey (no real company or posting).
 */
test("a senior résumé's list retrieves roles listed Lead and lists them", { tag: ["@J-JOBS-152"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await seedResume(page);
  const lead = posting("cccccccc-0000-4000-8000-000000000001", "Technical Account Manager", "Beacon Cloud", "lead", 2);
  const nurse = posting("cccccccc-0000-4000-8000-000000000002", "Registered Nurse", "Lakeside Health", "mid", 1);
  const levels: string[][] = [];
  await withAccountApplications(page, []);
  await page.route("**/*", async (route) => {
    const req = route.request();
    if (!isListSearch(req)) return route.fallback();
    const parsed = JSON.parse(req.postData() ?? "{}") as { fromResume?: boolean; offset?: number; facets?: { experience_level?: string[] } };
    if (!parsed.fromResume || (parsed.offset ?? 0) !== 0) return route.fallback();
    levels.push(parsed.facets?.experience_level ?? []);
    return answerListSearch(route, { hits: [nurse, lead], total: 2, backend: "meilisearch", configured: true, searchId: "journey-lead-level" });
  });
  await openFitList(page);
  await expect(page.getByTestId("job-row")).toHaveCount(1, { timeout: 60_000 });
  await expect(listRow(page, lead.id)).toBeVisible();
  // Every search that filters by level (a count with the level filter taken off sends none) asks for Lead too.
  const filtered = levels.filter((asked) => asked.length > 0);
  expect(filtered.length).toBeGreaterThan(0);
  for (const asked of filtered) expect([...asked].sort()).toEqual(["lead", "mid", "senior"]);
  expect(diagnostics.pageErrors).toEqual([]);
});

/**
 * J-JOBS-153 — 2026-10-17, from the outside analysis Vivek sent ("215 remote PM roles with no country dropped early"): the
 * search kept at most 20 remote roles that name no country, and only rows in its first 120 had their posting read for
 * where they hire. Now every such role the résumé's lanes find is kept past its 20 and read, and the list places each by
 * what its posting says: one that hires in Canada ranks with the placed roles, one for the US is left out, and one that
 * says nowhere comes last. The postings are CONSTRUCTED for this journey (no real company or posting).
 */
test("a remote role that names no country is placed by what its posting says about where it hires", { tag: ["@J-JOBS-153"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await seedResume(page);
  const noCountry = { location: "Remote", location_city: null, location_state: null, location_country: null, work_type: "remote" };
  const placed = posting("dddddddd-0000-4000-8000-000000000001", "Technical Account Manager", "Beacon Cloud", "senior", 2);
  // Says nowhere it hires, and is the freshest: without a place it still comes last.
  const nowhere = { ...posting("dddddddd-0000-4000-8000-000000000002", "Technical Account Manager", "Driftwood Apps", "senior", 1), ...noCountry, place_restriction: null };
  const canada = { ...posting("dddddddd-0000-4000-8000-000000000003", "Technical Account Manager", "Maple Relay", "senior", 3), ...noCountry, place_restriction: { label: "Canada", countries: ["Canada"] } };
  const usOnly = { ...posting("dddddddd-0000-4000-8000-000000000004", "Technical Account Manager", "Prairie Stack", "senior", 1), ...noCountry, place_restriction: { label: "United States", countries: ["United States"] } };
  await withAccountApplications(page, []);
  await page.route("**/*", async (route) => {
    const req = route.request();
    if (!isListSearch(req)) return route.fallback();
    const parsed = JSON.parse(req.postData() ?? "{}") as { fromResume?: boolean; offset?: number };
    if (!parsed.fromResume || (parsed.offset ?? 0) !== 0) return route.fallback();
    const hits = [placed, nowhere, canada, usOnly];
    return answerListSearch(route, { hits, total: hits.length, backend: "meilisearch", configured: true, searchId: "journey-no-country" });
  });
  await openFitList(page);
  await expect(page.getByTestId("job-row")).toHaveCount(3, { timeout: 60_000 });
  const ids = await rowIds(page);
  expect([...ids.slice(0, 2)].sort(), "the role whose posting says Canada ranks with the placed one").toEqual([placed.id, canada.id].sort());
  expect(ids[2], "the role that says nowhere comes last").toBe(nowhere.id);
  await expect(listRow(page, usOnly.id)).toHaveCount(0);
  expect(diagnostics.pageErrors).toEqual([]);
});

/**
 * J-JOBS-154 — 2026-10-17, from the outside analysis Vivek sent ("exact title phrases miss ... Product Lead"): a
 * title phrase finds only its own words, so a senior résumé for "Technical Account Manager" never asked for a "Technical
 * Account Lead", and one it met read as no kind of role (Stretch). Now a senior list also asks for its title's lead
 * name, and a role titled that way reads as the same line of work. The posting is CONSTRUCTED for this journey.
 */
test("a senior résumé's list asks for its title's lead name and lists a role titled that way as its own line of work", { tag: ["@J-JOBS-154"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await seedResume(page);
  const lead = posting("eeeeeeee-0000-4000-8000-000000000001", "Technical Account Lead", "Beacon Cloud", "senior", 2);
  const asked: string[] = [];
  await withAccountApplications(page, []);
  await page.route("**/*", async (route) => {
    const req = route.request();
    if (!isListSearch(req)) return route.fallback();
    const parsed = JSON.parse(req.postData() ?? "{}") as { fromResume?: boolean; offset?: number; q?: string };
    if (!parsed.fromResume || (parsed.offset ?? 0) !== 0) return route.fallback();
    asked.push(parsed.q ?? "");
    return answerListSearch(route, { hits: [lead], total: 1, backend: "meilisearch", configured: true, searchId: "journey-lead-title" });
  });
  await openFitList(page);
  await expect(listRow(page, lead.id)).toBeVisible({ timeout: 60_000 });
  await expect(listRow(page, lead.id).getByTestId("match-chip")).toHaveText("Strong");
  expect(asked.length).toBeGreaterThan(0);
  expect(asked.some((q) => q.includes('"Technical Account Lead"')), asked.join(" | ")).toBe(true);
  expect(diagnostics.pageErrors).toEqual([]);
});

/**
 * J-JOBS-155 — 2026-10-17, Vivek's Search screenshot: Rezdy's "Associate Product Manager" read Strong for his 13-year
 * senior résumé. An opening "Associate" is the entry rung of the role it names, so the role is two levels below a
 * senior résumé and out of its lists, whatever level the listing gives. The postings are CONSTRUCTED for this journey.
 */
test("a senior résumé's list leaves out a role titled Associate, even when it is listed mid-level", { tag: ["@J-JOBS-155"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await seedResume(page);
  const associate = posting("ffffffff-0000-4000-8000-000000000001", "Associate Technical Account Manager", "Fernway", "mid", 1);
  const own = posting("ffffffff-0000-4000-8000-000000000002", "Technical Account Manager", "Beacon Cloud", "senior", 2);
  await withAccountApplications(page, []);
  await answerResumeSearch(page, [associate, own], "journey-associate");
  await openFitList(page);
  await expect(page.getByTestId("job-row")).toHaveCount(1, { timeout: 60_000 });
  await expect(listRow(page, own.id)).toBeVisible();
  await expect(listRow(page, associate.id)).toHaveCount(0);
  expect(diagnostics.pageErrors).toEqual([]);
});

test("the list never lists a Staff, Principal or Director role to a résumé that shows none, and asks the search to leave them out", { tag: ["@J-JOBS-130"] }, async ({ page, diagnostics }) => {
  // Vivek, 2026-10-14: "the majority of them are staff level... way senior to senior roles". The scale ends at
  // senior, so these read senior and fitted; a role past Senior is now left out of the pool and of the list.
  await returningVisitor(page);
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
    // Sent anyway, as a cached or older answer could: the list still leaves them out.
    const hits = [staff, principal, director, executive, own, senior];
    return answerListSearch(route, { hits, total: hits.length, backend: "meilisearch", configured: true, searchId: "journey-past-senior" });
  });
  await openFitList(page);

  await expect(page.getByTestId("job-row")).toHaveCount(2, { timeout: 60_000 });
  for (const gone of [staff, principal, director, executive]) await expect(listRow(page, gone.id)).toHaveCount(0);
  expect(marks.length).toBeGreaterThan(0);
  expect(marks.every((m) => m.omitPastSenior === true), "every résumé-built search asks to leave out roles past Senior").toBe(true);
  expect(diagnostics.pageErrors).toEqual([]);
});

test("a résumé whose own title is Staff keeps Staff roles: the list does not ask the search to leave them out", { tag: ["@J-JOBS-130"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
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
  await openFitList(page);

  await expect(listRow(page, staff.id)).toBeVisible({ timeout: 60_000 });
  expect(marks.length).toBeGreaterThan(0);
  expect(marks.every((m) => m.omitPastSenior === undefined), "no leave-out flag for a Staff résumé").toBe(true);
  expect(diagnostics.pageErrors).toEqual([]);
});

/**
 * J-JOBS-131 — Vivek, 2026-10-14: "the recommendations are still garbage and the product is still unusable".
 * A list ranked against the résumé is not a search: it lists only roles the résumé could take, and says how many it left out and why.
 */
const FRENCH_ASK =
  "You are fluent in French and English. You will own technical onboarding for enterprise accounts and run quarterly reviews with customers. We are a growing company with a friendly team.";
/** The years only in the text (the listing's structured field is missing on about half the postings): 15+ against the résumé's seven in the line. */
const YEARS_ASK =
  "What you bring:\n15+ years of relevant experience\nStrong communication. You will own technical onboarding for enterprise accounts and run quarterly reviews with customers. We are a growing company with a friendly team.";

test("the list holds only roles the résumé could take, and says how many it left out and why", { tag: ["@J-JOBS-131"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
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
  await openFitList(page);

  // Two of the seven fit: the own role and a customer success role. The rest are not in the list.
  await expect(page.getByTestId("job-row")).toHaveCount(2, { timeout: 60_000 });
  for (const gone of [french, pm, junior, staff, veteran]) await expect(listRow(page, gone.id)).toHaveCount(0);
  await expect(page.getByTestId("result-line")).toHaveText("2 roles fit your résumé · best fit first");
  await expect(page.getByTestId("list-left-out")).toHaveText(
    "Left out of the 7 roles found: 2 above your level · 2 asking for something your résumé doesn't show · 1 a different kind of role",
  );
  expect(diagnostics.pageErrors).toEqual([]);
});

test("a list with no role the résumé could take says so and why, instead of a generic empty list", { tag: ["@J-JOBS-131"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await seedResume(page);
  const french = { ...posting("77777777-0000-4000-8000-000000000001", "Technical Account Manager", "Maison Nord", "senior", 2), description: FRENCH_ASK };
  const staff = posting("77777777-0000-4000-8000-000000000002", "Staff Technical Account Manager", "Juniper Labs", "senior", 1);
  await withAccountApplications(page, []);
  await answerResumeSearch(page, [french, staff], "journey-none-fit");
  // No count line to wait for: with no role to count, the headline is the empty state's own.
  await page.goto("/jobs");

  await expect(page.getByTestId("list-none-fit")).toContainText("None of the roles we found fit your résumé yet.", { timeout: 60_000 });
  await expect(page.getByTestId("list-left-out")).toHaveText("Left out of the 2 roles found: 1 above your level · 1 asking for something your résumé doesn't show");
  // Nothing is hidden for good: one tap lists every role the search found.
  await expect(page.getByTestId("list-none-fit-show-all")).toBeVisible();
  expect(diagnostics.pageErrors).toEqual([]);
});


/**
 * J-JOBS-132 — Vivek, 2026-10-14: "FIRST MATCH the rest of the experience and skills content to the job profiles
 * and then match the title if necessary AT THE END"; 2026-10-15: "that is how people find adjacent roles or titles
 * that they haven't heard of but are very well qualified for". The list holds a role whose title the résumé never
 * names when its posting asks for what the résumé shows, and puts it ahead of a posting that is only its title;
 * a remote role that names no country is listed last, as Country unclear.
 * The postings are CONSTRUCTED for this journey (no real company or posting).
 */
// Headings stand alone on their line, with a blank line after: the shape the section reader (pack-sections.ts) recognises. A
// heading glued to its text by one newline is not read, and the posting would count as one run of text with no responsibilities.
const askingForTheResumeWork = (company: string, title: string) => [
  `About the role\n\n${company} is hiring a ${title}.`,
  "What you'll do\n\nOwn the adoption and renewal plan for enterprise accounts. Handle technical escalations and API integration issues with engineering, work with product managers on the roadmap, and report on customer health and usage with SQL and Salesforce. Lead onboarding and quarterly business reviews for strategic enterprise customers.",
  "What you bring\n\n6+ years of experience\nExperience with REST APIs\nExperience with Salesforce\nExperience with SQL\nExperience with enterprise customers",
].join("\n\n");
const GENERIC_DESCRIPTION =
  "About the role\nNorthstar Data is hiring a Technical Account Manager.\n\nWhat you'll do\nWe are looking for a Technical Account Manager to join our team. You will work with a variety of stakeholders and grow with a fast-moving company.";

const described = (job: ReturnType<typeof posting>, description: string) => ({ ...job, description, jd_terms: jdTermsFromDescription(description, job as never) });

test("the list holds a title the résumé never names when its posting asks for what the résumé shows, ahead of a posting that is only its title, and a remote role with no country last", { tag: ["@J-JOBS-132"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await seedResume(page);
  const led = described(posting("88888888-0000-4000-8000-000000000001", "Customer Delivery Lead, API Programs", "Orchard CRM", "senior", 3), askingForTheResumeWork("Orchard CRM", "Customer Delivery Lead, API Programs"));
  const generic = described(posting("88888888-0000-4000-8000-000000000002", "Technical Account Manager", "Northstar Data", "senior", 2), GENERIC_DESCRIPTION);
  const noCountry = described(
    { ...posting("88888888-0000-4000-8000-000000000003", "Technical Account Manager", "Fernway", "senior", 1), location: "Remote", location_city: null, location_state: null, location_country: null, work_type: "remote" } as never,
    askingForTheResumeWork("Fernway", "Technical Account Manager"),
  );
  await withAccountApplications(page, []);
  // Sent generic first, as a search that matches on title would: the list puts the posting that asks for the résumé's work ahead of it.
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
  await openFitList(page);

  await expect(page.getByTestId("job-row")).toHaveCount(3, { timeout: 60_000 });
  await expect.poll(() => rowIds(page)).toEqual([led.id, generic.id, noCountry.id]);
  await expect(listRow(page, led.id).getByTestId("match-chip")).toHaveText("Strong");
  await expect(listRow(page, noCountry.id).getByTestId("match-chip")).toHaveText("Country unclear");

  // The search asked for postings by what they say, with a few skill phrases and no name or contact detail.
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
 * J-JOBS-133 / J-JOBS-134 — the gate, 2026-10-15: J-JOBS-100, 50, 52 and 80 failed at the staging head because a list
 * held no roles for their fixture résumé (a short one: five skills, two jobs). Nearly every posting lists
 * tools or requirements such a résumé cannot "show", and the list left each one out. A list the résumé does not answer
 * is a ranking signal, not a reason to leave the role out (a short résumé is not judged by it at all); an explicit ask
 * the résumé does not show (a language, a clearance, years, managing, selling, a certification) still takes a role out
 * (J-JOBS-131); and a list where nothing fits shows the closest roles under an honest line, not an empty list.
 * The postings are CONSTRUCTED for these journeys (no real company or posting).
 */
const listingTools = (company: string, tools: string[]) =>
  [
    `About the role\n${company} is hiring a Technical Account Manager.`,
    "What you'll do\nOwn the adoption and renewal plan for enterprise accounts and run technical escalations with engineering.",
    `What you bring\n6+ years of experience\n${tools.map((tool) => `Experience with ${tool}`).join("\n")}`,
  ].join("\n\n");

test("a short résumé's list still holds roles in its own line whose postings list tools the résumé does not show", { tag: ["@J-JOBS-133"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await seedResume(page);
  const tools = ["Gainsight", "Snowflake", "Looker", "Tableau", "Zendesk"];
  const withTools = (id: string, company: string, daysOld: number) =>
    described(posting(id, "Technical Account Manager", company, "senior", daysOld), listingTools(company, tools));
  const roles = [
    withTools("aaaaaaaa-0000-4000-8000-000000000001", "Orchard CRM", 1),
    withTools("aaaaaaaa-0000-4000-8000-000000000002", "Juniper Labs", 2),
    withTools("aaaaaaaa-0000-4000-8000-000000000003", "Fernway", 3),
  ];
  // The same listing asking for French: an explicit ask the résumé does not show. That ranks the role
  // lower (it stays in the list, so the headline counts it) rather than cutting it. A guest's free
  // preview still stops at three rows, so this one is the row behind the sign-in gate.
  const french = described(posting("aaaaaaaa-0000-4000-8000-000000000004", "Technical Account Manager", "Maison Nord", "senior", 1), `${listingTools("Maison Nord", tools)}\n\nYou are fluent in French and English.`);
  await withAccountApplications(page, []);
  await answerResumeSearch(page, [french, ...roles], "journey-short-resume");
  await openFitList(page);

  await expect(page.getByTestId("job-row")).toHaveCount(3, { timeout: 60_000 });
  await expect(listRow(page, french.id)).toHaveCount(0);
  await expect(page.getByTestId("list-notice")).toHaveCount(0);
  await expect(page.getByTestId("result-line")).toHaveText("4 roles · ranked by fit");
  await expect(page.getByTestId("list-left-out")).toHaveText("Left out of the 4 roles found: 1 asking for something your résumé doesn't show");
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


test("a list where nothing fits holds the closest roles under an honest line, not an empty list", { tag: ["@J-JOBS-134"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
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
  await openFitList(page);

  await expect(page.getByTestId("list-notice")).toContainText("Add detail to your résumé for closer matches", { timeout: 60_000 });
  await expect(page.getByTestId("list-none-fit")).toHaveCount(0);
  await expect(page.getByTestId("job-row")).toHaveCount(2);
  for (const row of await page.getByTestId("job-row").all()) await expect(row.getByTestId("match-chip")).toHaveText("Stretch");
  await expect(page.getByTestId("result-line")).toHaveText("2 closest roles · each a weaker fit");
  await expect(page.getByTestId("list-left-out")).toHaveText("Left out of the 3 roles found: 1 above your level");
  expect(diagnostics.pageErrors).toEqual([]);
});

// J-JOBS-144 (second case) — when not even a newer role is close, the closest older roles stand in, each a weaker fit,
// under a line that says so, instead of an empty list.
test("a list where only older roles are posted and none fits holds the closest of them, each a weaker fit with its age", { tag: ["@J-JOBS-144"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await seedResume(page, RICH_RESUME);
  // Constructed, as in J-JOBS-134: titled like the résumé's own role, asking for four things a TAM résumé does not show.
  const unrelated = (id: string, company: string, daysOld: number) =>
    described(
      posting(id, "Technical Account Manager", company, "senior", daysOld),
      [
        `About the role\n${company} is hiring a Technical Account Manager.`,
        "Requirements\n- Hands-on welding and brazing of structural steel\n- Operating a forklift and overhead crane safely\n- Pipefitting and boiler maintenance in plant settings\n- Erecting scaffolding to site safety standards",
      ].join("\n\n"),
    );
  const closeOld = [unrelated("cccccccc-0000-4000-8000-000000000001", "Steelhead Works", 40), unrelated("cccccccc-0000-4000-8000-000000000002", "Ironbridge", 55)];
  await withAccountApplications(page, []);
  await answerResumeSearch(page, closeOld, "journey-closest-older");
  await openFitList(page);

  await expect(page.getByTestId("list-notice")).toContainText("add detail to your résumé for closer matches", { timeout: 60_000 });
  await expect(page.getByTestId("list-none-fit")).toHaveCount(0);
  await expect(page.getByTestId("job-row")).toHaveCount(2);
  for (const row of await page.getByTestId("job-row").all()) {
    await expect(row.getByTestId("posted-age")).toHaveText(/^[12]mo ago$/);
    await expect(row.getByTestId("match-chip")).toHaveText("Stretch");
  }
  await expect(page.getByTestId("result-line")).toHaveText("2 roles · ranked by fit");
  expect(diagnostics.pageErrors).toEqual([]);
});

/**
 * J-JOBS-135 — coordinator, 2026-10-15 (Vivek: the lists recommend roles the others do not): every list that
 * recommends orders and leaves out the same way. The list counts the roles it holds (not the roles the search found), says
 * what it left out, and holds the same roles the daily picks and the MCP tools would.
 * The postings are CONSTRUCTED for this journey (no real company or posting).
 */
test("the list counts the roles it holds, not the roles the search found, and says what it left out", { tag: ["@J-JOBS-135"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await seedResume(page);
  const own = posting("99999999-0000-4000-8000-000000000001", "Technical Account Manager", "Northstar Data", "senior", 1);
  const csm = posting("99999999-0000-4000-8000-000000000002", "Senior Customer Success Manager", "Orchard CRM", "senior", 3);
  const old = posting("99999999-0000-4000-8000-000000000003", "Technical Account Manager", "Harbor Pay", "senior", 70);
  const nurse = posting("99999999-0000-4000-8000-000000000004", "Registered Nurse", "Lakeside Health", "mid", 1);
  await withAccountApplications(page, []);
  // Sent worst first, as a search that matches on words would: four roles found, two of them for this résumé.
  await answerResumeSearch(page, [nurse, old, csm, own], "journey-parity");
  await openFitList(page);

  await expect(page.getByTestId("result-line")).toHaveText("2 roles fit your résumé · best fit first", { timeout: 60_000 });
  await expect(page.getByTestId("job-row")).toHaveCount(2);
  expect((await rowIds(page)).sort()).toEqual([own.id, csm.id].sort());
  await expect(page.getByTestId("list-left-out")).toContainText("Left out of the 4 roles found");
  expect(diagnostics.pageErrors).toEqual([]);
});

/**
 * J-JOBS-148 — Vivek, 2026-10-16 (a hub saying "15 matches" and "220+ matches" over a Today with one role: "very
 * confusing", "and inconsistent"): one list, one number by its name. The count line counts the roles the list opens with,
 * a role already applied to is not in it, the list gives each employer one row and says so ("3 roles fit your résumé at
 * 2 employers"), and the left-out line says how many of the roles the search found it read ("the first 6 of 226 roles
 * found"). The postings are CONSTRUCTED for this journey (no real company or posting).
 */
test("the list counts roles and employers in one set of words, and a role already applied to is not in it", { tag: ["@J-JOBS-148"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await seedResume(page);
  const own = posting("aaaaaaaa-0000-4000-8000-000000000001", "Technical Account Manager", "Beacon Cloud", "senior", 1);
  const csm = posting("aaaaaaaa-0000-4000-8000-000000000002", "Senior Customer Success Manager", "Orchard CRM", "senior", 3);
  const csmEnterprise = posting("aaaaaaaa-0000-4000-8000-000000000005", "Customer Success Manager, Enterprise", "Orchard CRM", "senior", 4);
  const old = posting("aaaaaaaa-0000-4000-8000-000000000003", "Technical Account Manager", "Harbor Pay", "senior", 70);
  const nurse = posting("aaaaaaaa-0000-4000-8000-000000000004", "Registered Nurse", "Lakeside Health", "mid", 1);
  // Northstar Data's Technical Account Manager role was applied to (the account's tracker), and is listed again under a new id.
  await withAccountApplications(page, [NORTHSTAR_APPLICATION]);
  // The search read six roles of the 226 it found.
  const read = [nurse, old, RELISTED, csmEnterprise, csm, own];
  await page.route("**/*", async (route) => {
    const req = route.request();
    if (!isListSearch(req)) return route.fallback();
    const parsed = JSON.parse(req.postData() ?? "{}") as { fromResume?: boolean; offset?: number };
    if (!parsed.fromResume || (parsed.offset ?? 0) !== 0) return route.fallback();
    return answerListSearch(route, { hits: read, total: 226, backend: "meilisearch", configured: true, searchId: "journey-one-count" });
  });
  await openFitList(page);

  // Three roles fit (not 226, not the 6 read, not the applied one), at two employers, said once, with what became of the rest.
  await expect(page.getByTestId("result-line")).toHaveText("3 roles fit your résumé at 2 employers · best fit first", { timeout: 60_000 });
  const leftOut = page.getByTestId("list-left-out");
  await expect(leftOut).toContainText("Left out of the first 6 of 226 roles found:");
  await expect(leftOut).toContainText("1 already applied to");
  await expect(leftOut).toContainText("1 posted over 30 days ago");

  // One row per employer: Beacon Cloud's role, and Orchard CRM's best role with the other inside it; never the applied one.
  await expect(page.getByTestId("job-row")).toHaveCount(2);
  const ids = await rowIds(page);
  expect(ids).toContain(own.id);
  expect(ids.filter((id) => id === csm.id || id === csmEnterprise.id)).toHaveLength(1);
  expect(ids).not.toContain(RELISTED.id);
  await expect(page.getByTestId("employer-more")).toHaveCount(1);
  await expect(page.getByTestId("employer-more-toggle")).toHaveText("1 more at Orchard CRM");
  expect(diagnostics.pageErrors).toEqual([]);
});

/**
 * Fourteen constructed roles at fourteen employers (three posted this week, nine with pay listed), answered in the browser
 * for every list search: the packs hub's tiles and the deck behind them read their share (J-JOBS-149, J-JOBS-150).
 */
async function answerHubRoles(page: Page) {
  // Fourteen roles at fourteen employers: three posted this week, nine with pay listed.
  const employers = ["Beacon Cloud", "Orchard CRM", "Harbor Pay", "Northstar Data", "Lumen Works", "Pinecone Labs", "Tidewater AI", "Cobalt Systems", "Juniper Cloud", "Redwood Metrics", "Summit Ledger", "Brightline", "Kestrel Data", "Maple Ridge Tech"];
  const titles = [
    "Technical Account Manager", "Senior Technical Account Manager", "Customer Success Manager, Enterprise", "Senior Customer Success Manager",
    "Strategic Customer Success Manager", "Technical Customer Success Manager", "Enterprise Technical Account Manager", "Senior Technical Account Manager, Cloud",
    "Customer Success Manager", "Customer Success Manager, Strategic Accounts", "Senior Customer Success Manager, SaaS", "Technical Account Manager, Platform",
    "Enterprise Customer Success Manager", "Technical Account Manager, Integrations",
  ];
  const roles = titles.map((title, i) => ({
    ...posting(`bbbbbbbb-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`, title, employers[i]!, "senior", i < 3 ? i + 1 : 9 + i),
    ...(i < 9 ? { salary_min: 110_000, salary_max: 150_000, salary_currency: "CAD", salary_period: "year" } : {}),
  }));
  await page.route("**/*", async (route) => {
    const req = route.request();
    if (!isListSearch(req)) return route.fallback();
    const parsed = JSON.parse(req.postData() ?? "{}") as { offset?: number; salaryMin?: number; postedBucket?: string; postedSinceMs?: number };
    if ((parsed.offset ?? 0) !== 0) return route.fallback();
    const hits =
      (parsed.salaryMin ?? 0) > 0
        ? roles.filter((r) => r.salary_min)
        : parsed.postedBucket === "7d" || parsed.postedSinceMs
          ? roles.filter((r) => Date.now() - r.posted_ts < 7 * DAY_MS)
          : roles;
    return answerListSearch(route, { hits, total: hits.length, backend: "meilisearch", configured: true, searchId: "journey-hub-tiles" });
  });
}


/**
 * J-JOBS-150 — Vivek, 2026-10-17: "there is no mention about our chrome extension..honestly, that extension is the best part of
 * our product...everything else sucks". The list ranked against the résumé and the signed-out front door say what the Chrome
 * extension does on a job page and give one way to add it. On the list it is a tile after the fourth role (it is not a role);
 * on the front door it sits under the résumé invite. It says four things in a few words each (the fit, the posting check,
 * the tailored résumé, filling the form and tracking it) and has one link, "Add to Chrome", to the extension's Chrome Web
 * Store item in a new tab. A page cannot tell whether the extension is installed, so it never says "Open". No other company
 * is named. The postings are CONSTRUCTED for this journey (no real company or posting).
 */
const EXTENSION_STORE_URL = "https://chromewebstore.google.com/detail/jndkidbobccmcjochgioiiiiaaaldjjd";

async function expectExtensionTile(page: Page) {
  const tile = page.getByTestId("extension-tile");
  await expect(tile).toBeVisible({ timeout: 60_000 });
  await expect(tile).toContainText("Velai for Chrome");
  const link = tile.getByTestId("extension-tile-link");
  await expect(link).toHaveText("Add to Chrome");
  await expect(link).toHaveAttribute("href", EXTENSION_STORE_URL);
  await expect(link).toHaveAttribute("target", "_blank");
  expect(await link.getAttribute("rel")).toContain("noopener");
  // Nothing on the page can tell it is installed, so there is no "Open".
  await expect(tile.getByRole("link", { name: /^open/i })).toHaveCount(0);
  expect(await tile.innerText()).not.toMatch(/linkedin|indeed|glassdoor|greenhouse|lever|workday|ashby|jobshifu/i);
  // On screen: the whole width of the card on a phone, beside the title on a desktop.
  const viewport = page.viewportSize()!;
  const box = (await tile.boundingBox())!;
  const linkBox = (await link.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  if (viewport.width < 600) expect(linkBox.width).toBeGreaterThanOrEqual(box.width - 60);
  else expect(linkBox.x).toBeGreaterThan(box.x + box.width / 2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  return tile;
}

test("the list tells what the Chrome extension does and links its store page, once, after the fourth role", { tag: ["@J-JOBS-150"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await seedResume(page);
  await withAccountApplications(page, []);
  await answerHubRoles(page);
  await openFitList(page);
  await expect(page.getByTestId("job-row")).toHaveCount(14, { timeout: 60_000 });
  await expect(page.getByTestId("result-line")).toHaveText("14 roles · ranked by fit");
  await expectExtensionTile(page);
  // It is not a role: once, between the fourth row and the fifth.
  await expect(page.getByTestId("extension-tile")).toHaveCount(1);
  const top = async (locator: ReturnType<Page["getByTestId"]>) => (await locator.boundingBox())!.y;
  const rows = page.getByTestId("job-row");
  expect(await top(rows.nth(3))).toBeLessThan(await top(page.getByTestId("extension-tile")));
  expect(await top(page.getByTestId("extension-tile"))).toBeLessThan(await top(rows.nth(4)));
  expect(withoutMockSignInHydration(diagnostics.pageErrors)).toEqual([]);
});

/**
 * J-JOBS-136 — Vivek, 2026-10-14/15: "FIRST MATCH the rest of the experience and skills content to the job profiles
 * and then match the title if necessary AT THE END"; "that is how people find adjacent roles or titles that they
 * haven't heard of". A posting whose title is another line of work's (a Software Engineer for a Technical Account
 * Manager) is listed, and leads a posting that is only the résumé's own title, when it asks for the work the résumé
 * shows and for skills the résumé lists; one that only shares some words stays out as a different kind of role.
 * The postings are CONSTRUCTED for this journey (no real company or posting).
 */
test("the list holds another line of work's title when its posting asks for what the résumé shows, and leaves out one that only shares some words", { tag: ["@J-JOBS-136"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
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
  await openFitList(page);

  await expect(page.getByTestId("job-row")).toHaveCount(2, { timeout: 60_000 });
  await expect.poll(() => rowIds(page)).toEqual([asked.id, generic.id]);
  await expect(listRow(page, asked.id).getByTestId("match-chip")).toHaveText("Strong");
  await expect(page.getByTestId("result-line")).toHaveText("2 roles fit your résumé · best fit first");
  await expect(page.getByTestId("list-left-out")).toHaveText("Left out of the 3 roles found: 1 a different kind of role");
  expect(diagnostics.pageErrors).toEqual([]);
});

/**
 * J-JOBS-137 — the reason on a listed role (the hover on its label, the line in the daily picks email and the MCP
 * `why`) says what the posting asks for that the résumé shows, not only the title, place and level.
 * The posting is CONSTRUCTED for this journey (no real company or posting).
 */
test("the reason on a role names what its posting asks for that the résumé shows", { tag: ["@J-JOBS-137"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await seedResume(page);
  const own = described(posting("dddddddd-0000-4000-8000-000000000001", "Technical Account Manager", "Orchard CRM", "senior", 2), askingForTheResumeWork("Orchard CRM", "Technical Account Manager"));
  await withAccountApplications(page, []);
  await answerResumeSearch(page, [own], "journey-reason-terms");
  await openFitList(page);

  await expect(listRow(page, own.id)).toBeVisible({ timeout: 60_000 });
  const chip = listRow(page, own.id).getByTestId("match-chip");
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
 * Strong on his list under a Product Manager résumé. A title the résumé has not held reads Strong only when the
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
  await seedResume(page);
  const led = described(posting("99999999-0000-4000-8000-000000000001", "Customer Delivery Lead, API Programs", "Orchard CRM", "senior", 3), askingForTheResumeWork("Orchard CRM", "Customer Delivery Lead, API Programs"));
  const tools = described(posting("99999999-0000-4000-8000-000000000002", "SecOps Engineer", "Alcumus", "senior", 1), sharingOnlyTheTools("Alcumus", "SecOps Engineer"));
  // Live descriptions often arrive as one run of text with no heading we read (Alcumus, Loopio, Risk Control, eBay on 2026-10-15): the same
  // work as the first posting's, under a title the résumé has not held. Its whole text is not evidence of the work, so it reads Good.
  // A title of no line of work we know: "Delivery Operations Lead" now reads as an operations role (J-JOBS-154), another line of work.
  const flatTitle = "Client Delivery Lead, API Programs";
  const flat = described(
    posting("99999999-0000-4000-8000-000000000003", flatTitle, "Fernway", "senior", 2),
    askingForTheResumeWork("Fernway", flatTitle).split("\n\n").filter((_, index) => index % 2 === 1).join(" ").replace(/\n/g, " "),
  );
  await withAccountApplications(page, []);
  // Sent the tools-only and the flat postings first, as a search that matches on words would: the list puts the one whose work is the résumé's ahead of them.
  await answerResumeSearch(page, [tools, flat, led], "journey-duty-led");
  await openFitList(page);

  await expect(page.getByTestId("job-row")).toHaveCount(3, { timeout: 60_000 });
  const ids = await rowIds(page);
  expect(ids[0]).toBe(led.id);
  await expect(listRow(page, led.id).getByTestId("match-chip")).toHaveText("Strong");
  for (const id of [tools.id, flat.id]) await expect(listRow(page, id).getByTestId("match-chip")).toHaveText("Good");
  expect(diagnostics.pageErrors).toEqual([]);
});

/**
 * J-JOBS-140 — Vivek, 2026-10-16: his live list held a "Product Engineering Coordinator" (a supply chain posting) and a
 * "Learning & Development Specialist" (a case management posting) as Good above his own role, because their titles name no
 * line of work and nothing in the match read what the postings are. A posting whose text clearly reads as a line of work
 * that is none of the résumé's (the learned lexicon, `jd_terms.family`) is a different kind of role, whatever its title:
 * left out like any other, while a title the résumé has not held whose work is the résumé's stays and reads Strong.
 * The postings are CONSTRUCTED for this journey (no real company or posting).
 */
test("a posting whose text reads as another line of work is left out as a different kind of role, whatever its title, and the résumé's own work stays", { tag: ["@J-JOBS-140"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await seedResume(page, RICH_RESUME);
  const led = described(posting("77777777-0000-4000-8000-000000000001", "Customer Delivery Lead, API Programs", "Orchard CRM", "senior", 3), askingForTheResumeWork("Orchard CRM", "Customer Delivery Lead, API Programs"));
  const supplyChain = described(posting("77777777-0000-4000-8000-000000000002", "Product Engineering Coordinator", "Semper Parts", "senior", 1), SUPPLY_CHAIN_TEXT);
  const caseWork = described(posting("77777777-0000-4000-8000-000000000003", "Learning & Development Specialist", "Hope Services", "senior", 1), SOCIAL_SERVICES_TEXT);
  await withAccountApplications(page, []);
  // Sent the two other lines of work first, as a search that matches on words would.
  await answerResumeSearch(page, [supplyChain, caseWork, led], "journey-content-family");
  await openFitList(page);

  await expect(page.getByTestId("job-row")).toHaveCount(1, { timeout: 60_000 });
  await expect(listRow(page, led.id)).toBeVisible();
  await expect(listRow(page, led.id).getByTestId("match-chip")).toHaveText("Strong");
  await expect(page.getByTestId("list-left-out")).toHaveText("Left out of the 3 roles found: 2 a different kind of role");
  expect(diagnostics.pageErrors).toEqual([]);
});

/**
 * J-JOBS-141 — Vivek, 2026-10-16, on release 47: "the first 2 are completely off". A "Commercial Finance Business
 * Partner" and a "Marketing Operations and Project Specialist" still read Good: no line of work reads clearly in
 * their text (the lexicon's finance words are accounting ones), so the content lane said nothing, and the general
 * words they share with any senior résumé ("performance", "planning", "analysis") carried them. A title tied to
 * none of the résumé's kinds of role is now Good only when its posting shows the résumé's work (its text reads as
 * one of the résumé's lines of work, or the résumé covers what it asks); otherwise it is a weaker fit, left out.
 * The postings are CONSTRUCTED for this journey (no real company or posting).
 */
test("a posting under a title the résumé can't place that shares only general words is left out as a weaker fit, and one whose work is the résumé's stays", { tag: ["@J-JOBS-141"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await seedResume(page, RICH_RESUME);
  const led = described(posting("77777777-0000-4000-8000-000000000011", "Customer Delivery Lead, API Programs", "Orchard CRM", "senior", 3), askingForTheResumeWork("Orchard CRM", "Customer Delivery Lead, API Programs"));
  const finance = described(posting("77777777-0000-4000-8000-000000000012", "Commercial Finance Business Partner", "Northgate Pharma", "senior", 1), COMMERCIAL_FINANCE_TEXT);
  await withAccountApplications(page, []);
  // Sent first and fresher, as a search that matches on words would.
  await answerResumeSearch(page, [finance, led], "journey-unproven-title");
  await openFitList(page);

  await expect(page.getByTestId("job-row")).toHaveCount(1, { timeout: 60_000 });
  await expect(listRow(page, led.id)).toBeVisible();
  await expect(listRow(page, led.id).getByTestId("match-chip")).toHaveText("Strong");
  await expect(page.getByTestId("list-left-out")).toHaveText("Left out of the 2 roles found: 1 a weaker fit");
  expect(diagnostics.pageErrors).toEqual([]);
});

/**
 * J-JOBS-142 — Vivek, 2026-10-16: "I dont want french jobs...how does a user make sure that they either get or
 * not get other language jobs". A posting WRITTEN in a language the person has not chosen (their résumé's language, plus
 * English, until they say otherwise; `jd_terms.lang`) is left out of the list with its language named, and the same
 * control that says so brings it back or takes it away again. The postings are CONSTRUCTED for this journey.
 */

/** `saveAgentPreferencesAction` answered in the browser as a signed-in account would be: it echoes the saved languages. Register after `withAccountApplications`. */
async function withSavedLanguages(page: Page) {
  await page.route(
    () => true,
    async (route) => {
      const req = route.request();
      if (req.method() !== "POST" || !req.headers()["next-action"]) return route.fallback();
      let languages: unknown;
      try {
        languages = (JSON.parse(req.postData() ?? "[]") as { search?: { languages?: unknown } }[])[0]?.search?.languages;
      } catch {
        return route.fallback();
      }
      if (!Array.isArray(languages)) return route.fallback();
      const res = await route.fetch();
      return route.fulfill({ response: res, body: withActionResult(await res.text(), { data: { configured: true, search: { languages }, answers: { custom: {} } } }) });
    },
  );
}

test("the list leaves out a posting written in a language the person has not chosen, says which, and one tap brings it back or takes it away", { tag: ["@J-JOBS-142"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await seedResume(page, RICH_RESUME);
  const own = described(posting("88888888-0000-4000-8000-000000000001", "Customer Delivery Lead, API Programs", "Orchard CRM", "senior", 3), askingForTheResumeWork("Orchard CRM", "Customer Delivery Lead, API Programs"));
  // In the résumé's own line of work and under an English title, but written in French.
  const french = described(posting("88888888-0000-4000-8000-000000000002", "Technical Account Manager", "Nordique Logiciels", "senior", 1), FRENCH_ACCOUNT_TEXT);
  await withAccountApplications(page, []);
  await withSavedLanguages(page);
  await answerResumeSearch(page, [french, own], "journey-language");
  await openFitList(page);

  const languages = page.getByTestId("list-languages");
  await expect(page.getByTestId("job-row")).toHaveCount(1, { timeout: 60_000 });
  await expect(listRow(page, own.id)).toBeVisible();
  await expect(page.getByTestId("list-left-out")).toHaveText("Left out of the 2 roles found: 1 written in French");
  await expect(languages.getByTestId("list-languages-chip-english")).toBeVisible();
  await expect(languages.getByTestId("list-languages-chip-french")).toHaveCount(0);
  await expect(languages.getByTestId("list-languages-include-french")).toHaveText("Include French (1)");

  // Include French: the posting is in the list, nothing is left out, and French is a language they read.
  await languages.getByTestId("list-languages-include-french").click();
  await expect(page.getByTestId("job-row")).toHaveCount(2, { timeout: 30_000 });
  await expect(listRow(page, french.id)).toBeVisible();
  await expect(page.getByTestId("list-left-out")).toHaveCount(0);
  await expect(languages.getByTestId("list-languages-chip-french")).toBeVisible();
  await expect(languages.getByTestId("list-languages-include-french")).toHaveCount(0);

  // Take it away again with the same control: back to one role, French left out and counted.
  await languages.getByRole("button", { name: "Stop showing postings written in French" }).click();
  await expect(page.getByTestId("job-row")).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByTestId("list-left-out")).toHaveText("Left out of the 2 roles found: 1 written in French");
  expect(withoutMockSignInHydration(diagnostics.pageErrors)).toEqual([]);
});

test("a guest's list leaves out a posting written in another language and says so, with no language control for a visitor with no account", { tag: ["@J-JOBS-145"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await seedResume(page, RICH_RESUME);
  const own = described(posting("99999999-0000-4000-8000-000000000011", "Customer Delivery Lead, API Programs", "Orchard CRM", "senior", 1), askingForTheResumeWork("Orchard CRM", "Customer Delivery Lead, API Programs"));
  const french = described(posting("99999999-0000-4000-8000-000000000012", "Technical Account Manager", "Nordique Logiciels", "senior", 1), FRENCH_ACCOUNT_TEXT);
  await answerResumeSearch(page, [french, own], "journey-language-guest");
  await page.goto("/jobs");

  // The same rule as the account's list: the French posting is not listed, and the line says why. The control that changes it
  // saves to an account, so a guest is not shown one.
  await expect.poll(() => rowIds(page), { timeout: 45_000 }).toEqual([own.id]);
  await expect(page.getByTestId("list-left-out")).toHaveText("Left out of the 2 roles found: 1 written in French");
  await expect(page.locator('[data-testid$="-languages"]')).toHaveCount(0);
  expect(diagnostics.pageErrors).toEqual([]);
});

/**
 * J-JOBS-146 — Vivek, 2026-10-16 ("proceed"): each employer gets ONE slot in a list that recommends, with its other
 * matching roles inside the slot, instead of a row each. The roles are CONSTRUCTED, each with no company domain, so the
 * employer is told by its name: three of Orchard CRM's openings (different titles, so they are three roles, not one
 * cross-posted) and one of Northstar Data's.
 */
const ORCHARD_TITLES = ["Customer Delivery Lead, API Programs", "Technical Account Manager", "Customer Success Manager, Enterprise"];
const orchardRoles = (prefix: string) =>
  ORCHARD_TITLES.map((title, i) => described(posting(`${prefix}-0000-4000-8000-00000000000${i + 1}`, title, "Orchard CRM", "senior", 1 + i), askingForTheResumeWork("Orchard CRM", title)));
const northstarRole = (prefix: string) =>
  described(posting(`${prefix}-0000-4000-8000-000000000004`, "Technical Account Manager", "Northstar Data", "senior", 2), askingForTheResumeWork("Northstar Data", "Technical Account Manager"));

test("the list gives each employer one row with its other roles inside it", { tag: ["@J-JOBS-146"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await seedResume(page, RICH_RESUME);
  const orchard = orchardRoles("cccccccc");
  const northstar = northstarRole("cccccccc");
  await withAccountApplications(page, []);
  await answerResumeSearch(page, [orchard[0]!, orchard[1]!, northstar, orchard[2]!], "journey-employer-deck");
  await openFitList(page);

  // Four roles, at two employers: two rows, not four. The headline counts the roles; the employers are the disclosure's first row.
  await expect(page.getByTestId("job-row")).toHaveCount(2, { timeout: 60_000 });
  await expect(page.getByTestId("result-line")).toHaveText("4 roles · ranked by fit");

  // The row with roles inside it is Orchard CRM's; Northstar Data's has none.
  const more = page.getByTestId("employer-more");
  await expect(more).toHaveCount(1);
  await expect(more.getByTestId("employer-more-toggle")).toHaveText("2 more at Orchard CRM");
  const nested = more.getByTestId("employer-more-role");
  await expect(nested).toHaveCount(2);
  const ids = await rowIds(page);
  const leadId = ids.find((id) => orchard.some((r) => r.id === id))!;
  const nestedIds = await nested.evaluateAll((els) => els.map((el) => el.getAttribute("data-job-id")!));
  expect(new Set([leadId, ...nestedIds])).toEqual(new Set(orchard.map((r) => r.id)));
  // Closed until asked: a list of employers stays a list of employers.
  await expect(nested.first()).toBeHidden();
  await more.getByTestId("employer-more-toggle").click();
  await expect(nested.first()).toBeVisible();
  // Each role inside keeps the fit label it has everywhere else, its place and its age, and opens its own page.
  for (const row of await nested.all()) {
    await expect(row).toContainText(/Strong|Good/);
    await expect(row).toContainText("Toronto");
    await expect(row.getByRole("link")).toHaveAttribute("href", /\/jobs\//);
  }
  expect(withoutMockSignInHydration(diagnostics.pageErrors)).toEqual([]);
});

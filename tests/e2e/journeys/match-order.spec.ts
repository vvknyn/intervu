import type { Page } from "@playwright/test";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { LOCAL_AI_RESUME_KEY } from "../../../src/lib/local-ai/resume-storage";
import { expect, test } from "./fixtures";
import { answerListSearch, isListSearch } from "./list-search";

/**
 * Journeys for how a résumé orders its matches — see tests/journeys/CATALOG.md (J-JOBS-90 to 93).
 * Read-only: the résumé lives in localStorage and the search answer is replaced in the browser.
 *
 * Reported 2026-09-30 with a Technical Account Manager résumé: "I don't even see a single TAM
 * role in my list". Every searched title scored full relevance because its words all appear
 * somewhere in the résumé, so senior Product Manager postings tied with TAM postings and won on
 * level. The candidate's own role now ranks first and a neighbouring role can't read Strong.
 */

const returningVisitor = (page: Page) =>
  page.addInitScript((key) => localStorage.setItem(key, "1"), ONBOARDING_COMPLETED_STORAGE_KEY);

/** Fabricated candidate (no real person): a Toronto TAM whose résumé also says "product" and "manager". */
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

const posting = (id: string, title: string, company: string, experience_level: string) => ({
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
  posted_at: new Date(Date.now() - 86_400_000).toISOString(),
  first_seen_at: null,
  updated_at: null,
  vacancy_status: "open",
  ghost_badge: "unscored",
});

/**
 * What the TAM résumé's search returned in the report: senior PM postings first, TAM postings
 * after them. Before the fix the three PMs scored 100 (Strong) and filled the guest's top 3.
 */
const LISTED = [
  posting("11111111-0000-4000-8000-000000000001", "Senior Product Manager, Payments", "Harbor Pay", "senior"),
  posting("11111111-0000-4000-8000-000000000002", "Staff Product Manager, Platform", "Lumen Analytics", "senior"),
  posting("11111111-0000-4000-8000-000000000003", "Senior Product Manager - Growth", "Cedar Health", "senior"),
  posting("11111111-0000-4000-8000-000000000004", "Customer Success Manager", "Orchard CRM", "mid"),
  posting("11111111-0000-4000-8000-000000000005", "Technical Account Manager", "Northstar Data", "mid"),
  posting("11111111-0000-4000-8000-000000000006", "Technical Account Manager II", "Quarry Software", "unknown"),
  posting("11111111-0000-4000-8000-000000000007", "Senior Technical Account Manager", "Beacon Security", "senior"),
];

/**
 * The list's search answers with LISTED, in the browser only: the search still runs, its answer
 * is replaced.
 */
const answerResumeSearch = (page: Page, listed = LISTED) =>
  page.route("**/*", async (route) => {
    const req = route.request();
    const body = req.postData() ?? "";
    // The list's first page (a guest's ranked Search reads the newest roles and orders them on the device).
    if (!isListSearch(req) || !body.includes('"withFacets":true') || !body.includes('"offset":0')) {
      return route.fallback();
    }
    const result = { hits: listed, total: listed.length, backend: "meilisearch", configured: true, searchId: "journey-tam" };
    return answerListSearch(route, result);
  });

async function openRankedSearch(page: Page, resume: object = TAM_RESUME, listed = LISTED) {
  await returningVisitor(page);
  await seedResume(page, resume);
  await answerResumeSearch(page, listed);
  await page.goto("/jobs?sort=fit");
  await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 45_000 });
}

test("a TAM résumé's ranked list opens on TAM roles, not the senior PM roles its words also cover", { tag: ["@J-JOBS-90"] }, async ({ page, diagnostics }) => {
  await openRankedSearch(page);
  const titles = page.getByTestId("job-row").getByTestId("job-title");
  // A guest sees the top 3, then the fit gate. The two TAM roles lead; the PM roles are not in the list (a different line of work),
  // and a Staff role is above the résumé's level.
  await expect(titles).toHaveCount(3, { timeout: 30_000 });
  const shown = await titles.allTextContents();
  expect(shown.slice(0, 2).every((title) => /Technical Account Manager/.test(title)), shown.join(" | ")).toBe(true);
  await expect(page.getByTestId("job-row").filter({ hasText: /Product Manager/ })).toHaveCount(0);
  expect(diagnostics.pageErrors).toEqual([]);
});
test("pointing at a match label says in plain English why it is Strong, Good or Stretch", { tag: ["@J-JOBS-91"] }, async ({ page }) => {
  await openRankedSearch(page);
  const first = page.getByTestId("job-row").first();
  await expect(first.getByTestId("job-title")).toHaveText(/Technical Account Manager/, { timeout: 30_000 });
  const chip = first.getByTestId("match-chip");
  await expect(chip).toHaveText("Strong");
  // A thin list's "Broaden this search" counts arrive after the rows and push them down. Point at
  // the label once it has stopped moving, or the pointer lands beside it.
  let at = "";
  await expect
    .poll(
      async () => {
        const box = await chip.boundingBox();
        const now = box ? `${Math.round(box.x)},${Math.round(box.y)}` : "";
        const still = now !== "" && now === at;
        at = now;
        return still;
      },
      { intervals: [1_000], timeout: 30_000, message: "the match label stopped moving" },
    )
    .toBe(true);
  // Hover on desktop. A phone has no hover: a tap opens the reason and stays on it, not the row under it.
  const phone = test.info().project.name === "mobile";
  const reason = page.getByTestId("match-reason").first();
  if (phone) {
    await chip.tap();
    await expect(reason).toBeVisible({ timeout: 10_000 });
  } else {
    await expect(async () => {
      await page.mouse.move(0, 0);
      await chip.hover();
      await expect(reason).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
  }
  if (phone) expect(new URL(page.url()).searchParams.get("job")).toBeNull();
  await expect(reason).toContainText("It's your own role: the title matches Technical Account Manager on your résumé.");
  // The level says what the résumé's level was read from (Vivek, 2026-10-06: "with why those results were returned").
  await expect(reason).toContainText(/\b\d+ years\b/);
  // Readable on the tooltip's own (inverted) background: it once rendered white on white.
  const [ink, paper] = await reason.evaluate((el) => [getComputedStyle(el).color, getComputedStyle(el.closest("[data-side]") ?? document.body).backgroundColor]);
  expect(ink).not.toBe(paper);
});

/**
 * Fabricated candidate (no real person) whose current job is Product Manager but whose summary
 * and skills lead with customer success: the shape of a résumé tailored for CS roles. Its list
 * used to open on Product Manager roles, which tied on every word and came first.
 */
const CS_LEANING_RESUME = {
  profile: { name: "Riley Chen", profession: "Product Manager", yearsOfExperience: 9, location: "Toronto, Ontario, Canada", email: "riley.chen.e2e@example.com", phone: "555-010-8821", linkedin: "", website: "" },
  experience: [
    { id: "exp1", company: "Northwind Cloud", role: "Product Manager", dates: "2014 - Present", description: "Named customer success and technical account lead for six enterprise customers: renewals, adoption, QBRs and escalations." },
  ],
  competencies: [
    { category: "Customer Success & Account Management", skills: ["Customer Success", "Account Management", "Renewals", "QBRs"] },
    { category: "Tools", skills: ["Salesforce", "Gainsight", "SQL"] },
  ],
  education: [{ id: "edu1", degree: "B.Com.", institution: "State University", year: "2014" }],
  generatedSummary: "Customer Success Manager with nine years of technical account work for enterprise SaaS customers.",
};

/** What its search returned: senior Product Manager roles first, customer success and TAM roles after. */
const CS_LISTED = [
  posting("33333333-0000-4000-8000-000000000001", "Senior Product Manager, Payments", "Harbor Pay", "senior"),
  posting("33333333-0000-4000-8000-000000000002", "Senior Product Manager - Growth", "Cedar Health", "senior"),
  posting("33333333-0000-4000-8000-000000000003", "Senior Product Manager, Platform", "Lumen Analytics", "senior"),
  posting("33333333-0000-4000-8000-000000000004", "Senior Technical Account Manager", "Beacon Security", "senior"),
  posting("33333333-0000-4000-8000-000000000005", "Senior Customer Success Manager", "Orchard CRM", "senior"),
  posting("33333333-0000-4000-8000-000000000006", "Enterprise Customer Success Manager", "Quarry Software", "senior"),
];

test("a résumé whose summary and skills lead with customer success opens on those roles, not its current job title's", { tag: ["@J-JOBS-93"] }, async ({ page, diagnostics }) => {
  await openRankedSearch(page, CS_LEANING_RESUME, CS_LISTED);
  const titles = page.getByTestId("job-row").getByTestId("job-title");
  // A guest sees the top 3: the two customer success roles (its own title), then the TAM role (the same kind of work).
  await expect(titles).toHaveCount(3, { timeout: 30_000 });
  await expect(titles).toHaveText(["Senior Customer Success Manager", "Enterprise Customer Success Manager", "Senior Technical Account Manager"]);
  expect(diagnostics.pageErrors).toEqual([]);
});

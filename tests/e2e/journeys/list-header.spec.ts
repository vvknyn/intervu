import type { Page } from "@playwright/test";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { LIST_HEADER_BUDGET, LIST_HEADER_LINES } from "../../../src/lib/jobs/list-header";
import { LOCAL_AI_RESUME_KEY } from "../../../src/lib/local-ai/resume-storage";
import { expect, test } from "./fixtures";
import { answerListSearch, isListSearch } from "./list-search";
import { signInLikeProduction, withoutMockSignInHydration } from "./signed-in";

/**
 * The list header's budget — see tests/journeys/CATALOG.md (J-JOBS-168, J-JOBS-169) and src/lib/jobs/list-header.ts.
 * Vivek, 2026-11-01, from a phone screenshot of the signed-in list: "I have asked for so many redesigns… this text is
 * overwhelming". Between the search controls and the first role the page held a hero, six browse chips, the Chrome tile,
 * a "Ranked by your résumé" strip, the count, a "1 new" line, an employer chip with the alert switch, "some may already
 * be filled" and "15 evaluated · 12 ranked lower": nine blocks, and the first role began 703px down an 844px screen.
 *
 * The rule is read off the rendered page: every text block of the header carries `data-header-line`, the lines are
 * the plan's own and there are at most its budget, and on a phone the first role begins in the top half of the screen.
 * Read-only: the résumé lives in localStorage, the account is the page's own mock, and the list search's answer is
 * replaced in the browser (the search still runs). The postings are constructed (no real company).
 */
const DAY_MS = 86_400_000;

const returningVisitor = (page: Page) =>
  page.addInitScript((key) => localStorage.setItem(key, "1"), ONBOARDING_COMPLETED_STORAGE_KEY);

/** Fabricated candidate (no real person): a Toronto Technical Account Manager. */
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

const posting = (n: number, title: string, company: string, domain: string, daysOld: number, extra: Record<string, unknown> = {}) => {
  const posted = new Date(Date.now() - daysOld * DAY_MS).toISOString();
  return {
    id: `0000000${n % 10}-0000-4000-8000-${String(n).padStart(12, "0")}`,
    title,
    company,
    company_domain: domain,
    location: "Toronto, ON",
    location_city: "Toronto",
    location_state: "Ontario",
    location_country: "Canada",
    work_type: "hybrid",
    description: null,
    employment_type: "full_time",
    experience_level: "senior",
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
    ...extra,
  };
};

const FILLER_TITLES = ["Warehouse Associate", "Line Cook", "Delivery Driver", "Electrician", "Store Manager", "Barista", "Welder", "Forklift Operator", "Plumber", "Cashier"];
/** One role that fits the résumé and a pile that do not: the shape that put "evaluated · ranked lower" under the count. */
const employerRoles = (domain: string, company: string) => [
  posting(1, "Technical Account Manager", company, domain, 45),
  ...FILLER_TITLES.map((title, i) => posting(10 + i, title, company, domain, 3)),
];

/** The first page of the list's search answers with `hits` (and `extra` result fields), in the browser only. */
const answerList = (page: Page, hits: object[], extra: Record<string, unknown> = {}) =>
  page.route("**/*", async (route) => {
    const req = route.request();
    const body = req.postData() ?? "";
    if (!isListSearch(req) || !body.includes('"offset":0')) return route.fallback();
    return answerListSearch(route, { hits, total: hits.length, backend: "meilisearch", configured: true, searchId: "journey-list-header", facetDistribution: {}, ...extra });
  });

test.afterEach(({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));

/** The header's lines as the page renders them, top to bottom, with where the first role begins. */
async function readHeader(page: Page) {
  return page.evaluate(() => {
    const lines = [...document.querySelectorAll("[data-header-line]")].map((el) => ({
      line: el.getAttribute("data-header-line") ?? "",
      visible: (el as HTMLElement).getBoundingClientRect().height > 0,
    }));
    const first = document.querySelector('[data-testid="job-row"]');
    return { lines: lines.filter((l) => l.visible).map((l) => l.line), firstRowTop: first ? Math.round(first.getBoundingClientRect().top + window.scrollY) : null };
  });
}

test("a signed-in résumé list keeps its header to one status line, one row of controls and one disclosure, with the first role on the first screen of a phone", { tag: ["@J-JOBS-168"] }, async ({ page, diagnostics }, testInfo) => {
  await returningVisitor(page);
  await seedResume(page);
  await signInLikeProduction(page, () => undefined);
  await answerList(page, employerRoles("wmg.example", "Constructed Music Group"));
  // The employer scope arrives from a link, as it did in the screenshot.
  await page.goto("/jobs?company=wmg.example");
  await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("result-line")).toBeVisible();

  // Entry points are for someone with no list: neither the hero, nor the privacy line, nor browse-by-field sits above a signed-in résumé list.
  await expect(page.getByTestId("front-door-field-links")).toHaveCount(0);
  await expect(page.getByTestId("front-door-privacy-line")).toHaveCount(0);

  // One status line says what the list is and how to change the résumé it ranks by; the employer scope and the alert are its controls row.
  const status = page.locator('[data-header-line="status"]');
  await expect(status).toHaveCount(1);
  await expect(status.getByTestId("result-line")).toBeVisible();
  await expect(status.getByTestId("resume-read-strip")).toContainText("Edit résumé");
  await expect(page.getByTestId("resume-read-strip")).toHaveCount(1);
  await expect(page.locator('[data-header-line="scope"]').getByTestId("company-scope-chip")).toContainText("wmg.example");
  await expect(page.locator('[data-header-line="scope"]').getByTestId("search-alert-switch")).toBeVisible();
  // The count already says the list is ranked by the résumé: no second line restates it, or that some roles may be filled.
  await expect(page.getByText(/Ranked by your résumé/)).toHaveCount(0);
  await expect(page.getByText(/some may already be filled/i)).toHaveCount(0);

  // The page's own lines are the plan's, each once, within the budget.
  const { lines, firstRowTop } = await readHeader(page);
  for (const line of lines) expect(LIST_HEADER_LINES as readonly string[]).toContain(line);
  expect(lines.length).toBeLessThanOrEqual(LIST_HEADER_BUDGET);
  expect(new Set(lines).size).toBe(lines.length);
  expect(lines.filter((l) => l === "band").length).toBeLessThanOrEqual(1);
  expect(lines.filter((l) => l === "note").length).toBeLessThanOrEqual(1);

  // On a phone the first role begins in the top half of the screen (it was 703px of 844px with the hero, six browse chips and nine blocks of text).
  if (testInfo.project.name === "mobile") {
    const viewport = page.viewportSize()!;
    expect(firstRowTop).not.toBeNull();
    expect(firstRowTop!).toBeLessThan(viewport.height * 0.55);
  }
  expect(withoutMockSignInHydration(diagnostics.pageErrors)).toEqual([]);
});

test("the front door keeps its hero and browse-by-field for someone with no list, and a search shows one note at a time", { tag: ["@J-JOBS-169"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  // A guest with no résumé at rest: the front door, whose lines the budget does not touch.
  await page.goto("/jobs");
  await expect(page.getByTestId("front-door-field-links")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("front-door-privacy-line")).toBeVisible();
  const frontDoor = await readHeader(page);
  expect(frontDoor.lines.length).toBeLessThanOrEqual(LIST_HEADER_BUDGET);

  // A search the engine had to relax, whose place it could not read, and which was served from cache: three notes
  // have something to say about how it was read, and one is shown (the highest priority).
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await answerList(page, [posting(1, "Technical Account Manager", "Constructed Cloud", "cloud.example", 2), posting(2, "Customer Success Manager", "Constructed Systems", "systems.example", 3)], {
    widened: true,
    unmatchedPlaceMentions: ["Atlantis"],
    meta: { degraded: true, reason: "cache" },
  });
  await page.goto("/jobs?q=technical+account+manager+in+atlantis&sort=relevance");
  await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 60_000 });
  const searched = await readHeader(page);
  const notes = page.locator('[data-testid$="-note"]:not([data-testid^="search-alert"])');
  expect(await notes.count()).toBe(1);
  await expect(notes.first()).toHaveAttribute("data-header-line", "note");
  expect(searched.lines.filter((l) => l === "note")).toEqual(["note"]);
  expect(searched.lines.length).toBeLessThanOrEqual(LIST_HEADER_BUDGET);
  for (const line of searched.lines) expect(LIST_HEADER_LINES as readonly string[]).toContain(line);
  // A search the person typed shows no hero and no browse chips above its results.
  await expect(page.getByTestId("front-door-field-links")).toHaveCount(0);
  expect(diagnostics.pageErrors).toEqual([]);
});

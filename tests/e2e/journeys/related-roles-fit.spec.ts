import type { Page } from "@playwright/test";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { LOCAL_AI_RESUME_KEY } from "../../../src/lib/local-ai/resume-storage";
import { expect, test } from "./fixtures";
import { SEARCH_RATE_LIMITED_MESSAGE, SEARCH_UNAVAILABLE_MESSAGE } from "../../../src/lib/jobs/result-state";
import { answerListSearch, isListSearch } from "./list-search";

/**
 * Journeys for the roles next to a typed title - see tests/journeys/CATALOG.md (J-JOBS-167, J-SRCH-41, J-SRCH-43, J-SRCH-44). Read-only:
 * the resume lives in localStorage and the answers are replaced in the browser.
 *
 * Vivek, 2026-11-01: "this needs to be used intelligently to appropriately adjust the search results...and also use
 * the same logic for autosuggest or type ahead too". Type-ahead lists the related roles under the title suggestions.
 * Best match first read them too (`relatedPreview`) and listed the ones that fit as Strong or Good; on prod a TAM
 * resume searching "product manager" then led with Solutions Consultants, so Best match lists the typed title only.
 */
const returningVisitor = (page: Page) =>
  page.addInitScript((key) => localStorage.setItem(key, "1"), ONBOARDING_COMPLETED_STORAGE_KEY);

/** Fabricated candidate (no real person): a Toronto TAM. */
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

/** Constructed postings (no real company). */
const posting = (n: number, title: string, company: string, extra: Record<string, unknown> = {}) => ({
  id: `77777777-0000-4000-8000-00000000000${n}`,
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
  experience_level: "mid",
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
  ...extra,
});

test("Best match lists the title that was typed and does not read the roles next to it", { tag: ["@J-JOBS-167"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await seedResume(page);
  const asked: string[] = [];
  await page.route("**/*", async (route) => {
    const req = route.request();
    const body = req.postData() ?? "";
    if (!isListSearch(req) || !body.includes('"offset":0') || !body.includes('"withFacets":true')) return route.fallback();
    asked.push(body);
    // A TAM résumé searching "product manager": the answer is the title's own postings. (Before this fix the page also
    // asked for the roles next to the title, and a Solutions Consultant role that fit a TAM résumé as Strong took the
    // top of the list ahead of the Product Manager rows.)
    const hits = [
      posting(1, "Product Manager", "Maple Relay", { tier: 1 }),
      posting(2, "Senior Product Manager", "Birch Cloud", { tier: 1 }),
    ];
    return answerListSearch(route, {
      hits,
      total: 2,
      tier1Total: 2,
      relatedTitles: [],
      backend: "meilisearch",
      configured: true,
      searchId: "journey-title-leads",
    });
  });
  await page.goto("/jobs?q=product%20manager&sort=fit");

  const titles = page.getByTestId("job-row").getByTestId("job-title");
  await expect(titles.first()).toBeVisible({ timeout: 45_000 });
  await expect(titles.first()).toHaveText(/Product Manager/, { timeout: 30_000 });
  await expect(page.getByTestId("job-row").filter({ hasText: "Solutions Consultant" })).toHaveCount(0);
  expect(asked.length, "the list search ran").toBeGreaterThan(0);
  expect(asked.some((body) => body.includes("relatedPreview")), "Best match does not ask for the roles next to the typed title").toBe(false);
  // The server leaves the related-role band out of a search marked as built for a résumé-ranked list (`fromResume`).
  expect(asked.every((body) => body.includes('"fromResume":true')), "the first page is marked as a résumé-ranked list").toBe(true);
  expect(diagnostics.pageErrors).toEqual([]);
});

test("type-ahead lists the roles next to what is typed under the title suggestions, and a pick searches it", { tag: ["@J-SRCH-41"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await page.route("**/api/jobs/suggest?**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ titles: ["Technical Account Manager"], companies: [], related: ["Account Manager", "Customer Success Manager"] }),
    }),
  );
  await page.goto("/jobs");
  await page.waitForLoadState("networkidle");
  const input = page.getByPlaceholder("Job title, skill, or company").first();
  await input.fill("technical acc");

  const related = page.getByRole("group", { name: "Related roles" });
  await expect(related).toBeVisible({ timeout: 15_000 });
  await expect(related.getByRole("option")).toHaveText(["Account Manager", "Customer Success Manager"]);
  // The related roles come after the titles that hold what is typed.
  const options = await page.getByRole("option").allInnerTexts();
  expect(options.map((o) => o.trim()).indexOf("Technical Account Manager")).toBeLessThan(options.map((o) => o.trim()).indexOf("Account Manager"));

  await related.getByRole("option", { name: "Customer Success Manager" }).click();
  await expect(page).toHaveURL(/[?&]q=Customer(\+|%20)Success(\+|%20)Manager(&|$)/);
  expect(diagnostics.pageErrors).toEqual([]);
});

test("a search for a title ending in a word a plain object already holds ('bridge constructor') answers like any other search", { tag: ["@J-SRCH-43"] }, async ({ page, diagnostics }) => {
  // The related-roles table is a plain object: its inherited `constructor` read as a table key and every search
  // ending in "constructor" came back "Search is temporarily unavailable". This runs the real search, unmocked.
  await returningVisitor(page);
  const answered = page.waitForResponse((res) => isListSearch(res.request()), { timeout: 45_000 });
  await page.goto("/jobs?q=bridge%20constructor");
  const res = await answered;
  const body = (await res.json()) as { configured?: boolean; unavailable?: boolean; note?: string };
  test.skip(body.configured === false, "no search backend behind this server");
  test.skip(body.note === SEARCH_RATE_LIMITED_MESSAGE, "turned away by the per-connection search limit (other journeys from this machine), not what this checks");
  expect(res.status()).toBe(200);
  expect(body.unavailable ?? false, `the search ran rather than failing (${body.note ?? ""})`).toBe(false);
  await expect(page.getByText(SEARCH_UNAVAILABLE_MESSAGE)).toHaveCount(0);
  expect(diagnostics.pageErrors).toEqual([]);
});

test("a title the map doesn't know gets no roles-next-to line borrowed from a shorter title it ends in ('customer success architect')", { tag: ["@J-SRCH-44"] }, async ({ page, diagnostics }) => {
  // R69 prod: "customer success architect" was shown "Roles next to customer success architect: Architectural Designer,
  // Design Manager and Construction Engineer" (read as "architect"). This runs the real list search, unmocked.
  await returningVisitor(page);
  const answered = page.waitForResponse((res) => isListSearch(res.request()), { timeout: 45_000 });
  await page.goto("/jobs?q=customer%20success%20architect&sort=relevance");
  const res = await answered;
  const body = (await res.json()) as { configured?: boolean; unavailable?: boolean; note?: string; relatedTitles?: string[]; hits?: Array<{ tier?: number }> };
  test.skip(body.configured === false, "no search backend behind this server");
  test.skip(body.note === SEARCH_RATE_LIMITED_MESSAGE, "turned away by the per-connection search limit (other journeys from this machine), not what this checks");
  expect(body.unavailable ?? false, `the search ran (${body.note ?? ""})`).toBe(false);
  expect(body.relatedTitles ?? [], "no related roles named").toEqual([]);
  expect((body.hits ?? []).filter((h) => h.tier === 3), "no related-role rows").toEqual([]);
  await expect(page.getByText(/Roles next to customer success architect/i)).toHaveCount(0);
  expect(diagnostics.pageErrors).toEqual([]);
});

import type { Page } from "@playwright/test";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { LOCAL_AI_RESUME_KEY } from "../../../src/lib/local-ai/resume-storage";
import { expect, test } from "./fixtures";
import { answerListSearch, isListSearch } from "./list-search";

/**
 * Journeys for the roles next to a typed title, used by fit and by type-ahead — see tests/journeys/CATALOG.md
 * (J-JOBS-167, J-SRCH-41). Read-only: the résumé lives in localStorage and the answers are replaced in the browser.
 *
 * Vivek, 2026-11-01: "this needs to be used intelligently to appropriately adjust the search results...and also use
 * the same logic for autosuggest or type ahead too". Best match reads the related roles' first rows too and lists
 * the ones that fit the résumé as Strong or Good (`keepsRelatedRow`); type-ahead lists the related roles under the
 * title suggestions.
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

test("Best match lists a related role that fits the résumé and leaves out one that does not", { tag: ["@J-JOBS-167"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await seedResume(page);
  const asked: string[] = [];
  await page.route("**/*", async (route) => {
    const req = route.request();
    const body = req.postData() ?? "";
    if (!isListSearch(req) || !body.includes('"offset":0') || !body.includes('"withFacets":true')) return route.fallback();
    asked.push(body);
    // One posting with the typed title, and two related-role rows the search read past it: a Customer Success Manager
    // role (Strong for this résumé) and an Account Executive one (Stretch).
    const hits = [
      posting(1, "Technical Account Manager", "Maple Relay", { tier: 1 }),
      posting(2, "Customer Success Manager", "Birch Cloud", { tier: 3, relatedPreview: true }),
      posting(3, "Account Executive", "Harbour Grid", { tier: 3, relatedPreview: true }),
    ];
    return answerListSearch(route, {
      hits,
      total: 1,
      tier1Total: 1,
      relatedTitles: ["Customer Success Manager", "Account Executive"],
      backend: "meilisearch",
      configured: true,
      searchId: "journey-related-fit",
    });
  });
  await page.goto("/jobs?q=technical%20account%20manager&sort=fit");

  const titles = page.getByTestId("job-row").getByTestId("job-title");
  await expect(titles.first()).toBeVisible({ timeout: 45_000 });
  await expect(titles).toHaveText(["Technical Account Manager", "Customer Success Manager"], { timeout: 30_000 });
  await expect(page.getByTestId("job-row").filter({ hasText: "Account Executive" })).toHaveCount(0);
  expect(asked.some((body) => body.includes('"relatedPreview":true')), "Best match asks for the related roles' rows").toBe(true);
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

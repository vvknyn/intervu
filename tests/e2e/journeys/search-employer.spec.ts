import type { Page } from "@playwright/test";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { expect, test } from "./fixtures";
import { answerListSearch } from "./list-search";

/**
 * Journeys for a search that names an employer — see tests/journeys/CATALOG.md (J-SRCH-46 to J-SRCH-50). Read-only:
 * J-SRCH-46 to 49 replace the answers in the browser; J-SRCH-50 reads the live index, as the release check did.
 *
 * Vivek, 2026-11-08: "I'm not seeing faceted type ahead results in the search bar... searching product manager
 * integral ad science should search for product manager jobs in that company if it exists...if not, show integral ad
 * science jobs followed by product manager jobs". The server half (which words are an employer, the order, the paging)
 * is unit-tested in jobs-company-intent.test.ts, jobs-suggestions.test.ts and employer-role.test.ts.
 */
const returningVisitor = (page: Page) =>
  page.addInitScript((key) => localStorage.setItem(key, "1"), ONBOARDING_COMPLETED_STORAGE_KEY);

/** Constructed postings (the employers are constructed names, not real companies). */
const role = (id: string, title: string, company: string, domain: string | null) => ({
  id,
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
});

const NORTHWIND = { name: "Northwind Ad Labs", domain: "northwind-adlabs.example" };

const searchBox = (page: Page) => page.getByPlaceholder("Job title, skill, or company").first();

test("type-ahead lists a Companies section first when the words name an employer, and a pick filters to that employer", { tag: ["@J-SRCH-46"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await page.route("**/api/jobs/suggest?**", (route) => {
    const q = new URL(route.request().url()).searchParams.get("q") ?? "";
    const roleWords = /^product manager /i.test(q);
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        titles: roleWords ? ["Product Manager"] : [],
        companies: [],
        employers: [{ ...NORTHWIND, ...(roleWords && { role: "product manager" }) }],
        employersFirst: true,
      }),
    });
  });
  // The list's own search, after the pick: the role at the employer.
  await page.route("**/api/jobs/search", (route) =>
    answerListSearch(route, {
      hits: [role("pm-1", "Senior Product Manager", NORTHWIND.name, NORTHWIND.domain)],
      total: 1,
      backend: "meilisearch",
      configured: true,
      searchId: "e2e-employer-pick",
      effectiveQ: "product manager",
      employer: { domains: [NORTHWIND.domain], name: NORTHWIND.name, role: "product manager", roleMatches: 1, source: "chosen" },
    }),
  );
  await page.goto("/jobs");
  await page.waitForLoadState("networkidle");

  // The employer's own name: a Companies section, listed before any role.
  await searchBox(page).fill("northwind ad labs");
  const companies = page.getByRole("group", { name: "Companies" });
  await expect(companies).toBeVisible({ timeout: 15_000 });
  await expect(companies.getByRole("option")).toHaveText([NORTHWIND.name]);

  // Role + employer words: the row reads as the role at the employer, ahead of the roles.
  await searchBox(page).fill("product manager northwind");
  await expect(companies.getByRole("option")).toHaveText(["product manager at Northwind Ad Labs"], { timeout: 15_000 });
  const groups = await page.getByRole("group").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
  expect(groups.indexOf("Companies")).toBeLessThan(groups.indexOf("Roles"));

  // A pick filters to the employer (the employer token, by name) and the box keeps only the role words.
  await companies.getByRole("option").first().click();
  await expect(page).toHaveURL(/[?&]company=northwind-adlabs\.example(&|$)/);
  await expect(page).toHaveURL(/[?&]q=product(\+|%20)manager(&|$)/);
  await expect(searchBox(page)).toHaveValue("product manager");
  await expect(page.getByTestId("company-scope-chip")).toContainText(NORTHWIND.name, { timeout: 30_000 });
  expect(diagnostics.pageErrors).toEqual([]);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("a typed role + employer search shows the employer as its token and keeps only the role words in the box", { tag: ["@J-SRCH-47"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await page.route("**/api/jobs/search", async (route) => {
    const body = route.request().postDataJSON() as { q?: string; companyDomain?: string };
    // The first answer reads the employer out of the words; the follow-up asks for it as the filter.
    const typed = !body.companyDomain;
    return answerListSearch(route, {
      hits: [role("pm-1", "Senior Product Manager", NORTHWIND.name, NORTHWIND.domain)],
      total: 1,
      backend: "meilisearch",
      configured: true,
      searchId: "e2e-employer-typed",
      effectiveQ: "product manager",
      employer: { domains: [NORTHWIND.domain], name: NORTHWIND.name, role: "product manager", roleMatches: 1, source: typed ? "typed" : "chosen" },
      ...(typed && {
        understood: { params: { companyDomain: NORTHWIND.domain }, residualQ: "product manager", source: "deterministic", employerName: NORTHWIND.name },
      }),
    });
  });
  await page.goto("/jobs?q=product%20manager%20northwind%20ad%20labs");
  await expect(page).toHaveURL(/[?&]company=northwind-adlabs\.example(&|$)/, { timeout: 60_000 });
  await expect(searchBox(page)).toHaveValue("product manager");
  await expect(page.getByTestId("company-scope-chip")).toContainText(NORTHWIND.name);
  // ✕ on the token searches the role at every employer.
  await page.getByTestId("company-scope-clear").click();
  await expect(page).not.toHaveURL(/[?&]company=/);
  await expect(searchBox(page)).toHaveValue("product manager");
  expect(diagnostics.pageErrors).toEqual([]);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("an employer with none of the role lists its other roles first, then the role at other employers, and says so", { tag: ["@J-SRCH-48"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  // Three of the employer's own roles in a row: the page's company interleave must not pull another employer's
  // role up between them, or the list would stop reading "its roles first".
  const hits = [
    role("own-1", "Account Executive", NORTHWIND.name, NORTHWIND.domain),
    role("own-2", "Data Analyst", NORTHWIND.name, NORTHWIND.domain),
    role("own-3", "Sales Engineer", NORTHWIND.name, NORTHWIND.domain),
    role("else-1", "Product Manager", "Contoso Media", "contoso.example"),
  ];
  await page.route("**/api/jobs/search", (route) =>
    answerListSearch(route, {
      hits,
      total: 4,
      backend: "meilisearch",
      configured: true,
      searchId: "e2e-employer-fallback",
      effectiveQ: "",
      employer: { domains: [NORTHWIND.domain], name: NORTHWIND.name, role: "product manager", roleMatches: 0, employerRoles: 3, source: "chosen" },
    }),
  );
  await page.goto(`/jobs?q=product%20manager&company=${NORTHWIND.domain}`);
  // In the order the answer gave: the employer's own roles, then the role elsewhere.
  await expect(page.getByTestId("job-row")).toContainText(["Account Executive", "Data Analyst", "Sales Engineer", "Product Manager"], { timeout: 60_000 });
  await expect(page.getByTestId("employer-role-note")).toHaveText(
    "No product manager roles at Northwind Ad Labs right now — showing its other roles first, then product manager roles at other employers.",
  );
  expect(diagnostics.pageErrors).toEqual([]);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("role + employer words where no employer here carries the name, and nothing matches them, list the role and say so", { tag: ["@J-SRCH-49"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await page.route("**/api/jobs/search", (route) =>
    answerListSearch(route, {
      hits: [role("pm-2", "Product Manager", "Contoso Media", "contoso.example")],
      total: 1,
      backend: "meilisearch",
      configured: true,
      searchId: "e2e-employer-not-found",
      effectiveQ: "product manager",
      unmatchedQueryMentions: ["integral ad science"],
    }),
  );
  await page.goto("/jobs?q=product%20manager%20integral%20ad%20science");
  await expect(page.getByTestId("unmatched-note")).toHaveText('We couldn\'t apply "integral ad science" — searched without it.', { timeout: 60_000 });
  await expect(page.getByTestId("job-row").first()).toContainText("Product Manager");
  expect(diagnostics.pageErrors).toEqual([]);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("an employer whose name holds a place word is searched as the employer, never as a place", { tag: ["@J-SRCH-50"] }, async ({ page, diagnostics }) => {
  // Release 74 on the live index: "bank of america" became q=of in the place "Bank" (UK). No stubbed answer here:
  // what the page reads out of the words is the server's, so this runs against the real index on prod.
  test.setTimeout(180_000);
  await returningVisitor(page);
  for (const q of ["bank of america", "product manager bank of america"]) {
    await page.goto(`/jobs?q=${encodeURIComponent(q)}`);
    // The list has answered: rows, no rows, or (a build with no index) a search that could not run.
    const answered = page
      .getByTestId("job-row")
      .or(page.getByTestId("search-empty-results"))
      .or(page.getByTestId("jobs-search-error"))
      .or(page.getByText(/We can't load results right now|Job search is being connected/));
    await expect(answered.first()).toBeVisible({ timeout: 60_000 });
    // Nothing in the words became a place: no place in the address, and the words stay whole (an employer read may
    // move the employer into its token and leave the role words, never "of" alone).
    expect(new URL(page.url()).searchParams.get("country") ?? "").not.toMatch(/bank|america/i);
    expect(new URL(page.url()).searchParams.get("q") ?? "").not.toBe("of");
    await expect(searchBox(page)).not.toHaveValue(/^(product manager )?of$/);
  }
  expect(diagnostics.pageErrors).toEqual([]);
});

import type { Page } from "@playwright/test";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { LOCAL_AI_RESUME_KEY } from "../../../src/lib/local-ai/resume-storage";
import { expect, test } from "./fixtures";
import { answerListSearch, isListSearch } from "./list-search";

/**
 * Journey for the "Hires in Canada" word on a remote role — see tests/journeys/CATALOG.md (J-JOBS-156).
 * Read-only: the résumé lives in localStorage and the search answer is replaced in the browser.
 *
 * From the CareerHound teardown Vivek asked for (2026-10-21): their pitch is that US postings which say Canadians
 * are welcome are found for you. Velai says it only with the posting's own line: a remote role whose place fields
 * don't say Canada alone, and whose posting hires there, reads "Hires in Canada" and shows the line.
 */

const returningVisitor = (page: Page) =>
  page.addInitScript((key) => localStorage.setItem(key, "1"), ONBOARDING_COMPLETED_STORAGE_KEY);

/** Fabricated candidate (no real person): a Toronto Technical Account Manager. */
const TAM_RESUME = {
  profile: { name: "Morgan Lee", profession: "Technical Account Manager", yearsOfExperience: 9, location: "Toronto, Ontario, Canada", email: "morgan.lee.e2e@example.com", phone: "555-010-4477", linkedin: "", website: "" },
  experience: [
    { id: "exp1", company: "Northwind Cloud", role: "Technical Account Manager", dates: "2019 - Present", description: "Owned adoption, renewals and technical escalations for 40 enterprise accounts." },
    { id: "exp2", company: "Maple Systems", role: "Technical Support Engineer", dates: "2015 - 2019", description: "Resolved API and integration issues for enterprise customers." },
  ],
  competencies: [{ category: "Skills", skills: ["Customer Success", "SQL", "REST APIs", "Salesforce"] }],
  education: [{ id: "edu1", degree: "B.Eng. Computer Engineering", institution: "State University", year: "2015" }],
  generatedSummary: "Technical Account Manager with nine years in customer success for enterprise SaaS customers.",
};

const seedResume = (page: Page) =>
  page.addInitScript(
    ([resumeKey, data]) => {
      localStorage.setItem(resumeKey as string, JSON.stringify({ data, updatedAt: new Date().toISOString(), sourceLabel: "e2e-synthetic" }));
    },
    [LOCAL_AI_RESUME_KEY, TAM_RESUME] as const,
  );

const remotePosting = (id: string, company: string, extra: Record<string, unknown>) => ({
  id,
  title: "Technical Account Manager",
  company,
  company_domain: null,
  location: "Remote",
  location_city: null,
  location_state: null,
  location_country: null,
  work_type: "remote",
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
  posted_at: new Date(Date.now() - 86_400_000).toISOString(),
  first_seen_at: null,
  updated_at: null,
  vacancy_status: "open",
  ghost_badge: "unscored",
  ...extra,
});

/** Constructed postings (no real company): the two ways a posting can say Canada beyond its place fields, and one whose place fields already do. */
const PLACE_TEXT = remotePosting("33333333-0000-4000-8000-000000000001", "Maple Relay", {
  location: "Remote, Canada; Austin, TX",
  location_country: "United States",
});
const DESCRIPTION = remotePosting("33333333-0000-4000-8000-000000000002", "Prairie Stack", {
  place_restriction: { label: "United States or Canada", countries: ["United States", "Canada"], quote: "This role is open to candidates located in the US or Canada." },
});
const CANADA_ONLY = remotePosting("33333333-0000-4000-8000-000000000003", "Birch Cloud", {
  location: "Remote, Canada",
  location_country: "Canada",
});

test("a remote role whose posting hires in Canada says 'Hires in Canada' with the posting's own line, and only then", { tag: ["@J-JOBS-156"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await seedResume(page);
  const listed = [PLACE_TEXT, DESCRIPTION, CANADA_ONLY];
  await page.route("**/*", async (route) => {
    const req = route.request();
    const body = req.postData() ?? "";
    if (!isListSearch(req) || !body.includes('"withFacets":true') || !body.includes('"offset":0')) return route.fallback();
    return answerListSearch(route, { hits: listed, total: listed.length, backend: "meilisearch", configured: true, searchId: "journey-hires-in" });
  });
  await page.goto("/jobs?view=search&sort=fit");
  const row = (company: string) => page.getByTestId("job-row").filter({ hasText: company });
  await expect(row("Maple Relay")).toBeVisible({ timeout: 45_000 });

  // The word, once per role, on the two roles whose posting hires in Canada beyond what their place fields say.
  await expect(row("Maple Relay").getByTestId("hires-in")).toContainText("Hires in Canada");
  await expect(row("Prairie Stack").getByTestId("hires-in")).toContainText("Hires in Canada");
  // Not on a role whose place fields already say Canada alone.
  await expect(row("Birch Cloud")).toBeVisible();
  await expect(row("Birch Cloud").getByTestId("hires-in")).toHaveCount(0);

  // The posting's own line: hover on desktop; a phone has no hover, so a tap opens it and stays on it, not the row under it.
  const word = row("Prairie Stack").getByTestId("hires-in").getByRole("button");
  const quote = page.getByTestId("hires-in-quote").first();
  if (test.info().project.name === "mobile") {
    await word.tap();
    await expect(quote).toBeVisible({ timeout: 10_000 });
    expect(new URL(page.url()).searchParams.get("job")).toBeNull();
  } else {
    await expect(async () => {
      await page.mouse.move(0, 0);
      await word.hover();
      await expect(quote).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
  }
  await expect(quote).toContainText("This role is open to candidates located in the US or Canada.");
  expect(diagnostics.pageErrors).toEqual([]);
});

/**
 * Journey for the place a plain "Remote" row says its posting limits it to — see tests/journeys/CATALOG.md (J-JOBS-157).
 * From the same CareerHound teardown: their cards tell Remote Canada from Remote North America from Remote US. Velai reads
 * it from the posting, so the row says "Remote (North America)" with the posting's line, and a posting that names no place
 * stays "Remote".
 */
test("a plain 'Remote' row says the place its posting limits it to, with the posting's line, and stays 'Remote' when the posting names none", { tag: ["@J-JOBS-157"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await seedResume(page);
  const northAmerica = remotePosting("44444444-0000-4000-8000-000000000001", "Cedar Relay", {
    place_restriction: { label: "North America", countries: ["Canada", "United States", "Mexico"], quote: "You can work from anywhere in North America." },
  });
  const canada = remotePosting("44444444-0000-4000-8000-000000000002", "Harbor Stack", {
    place_restriction: { label: "Canada", countries: ["Canada"], quote: "Remote in Canada." },
  });
  const nowhere = remotePosting("44444444-0000-4000-8000-000000000003", "Driftwood Apps", { place_restriction: null });
  const listed = [northAmerica, canada, nowhere];
  await page.route("**/*", async (route) => {
    const req = route.request();
    const body = req.postData() ?? "";
    if (!isListSearch(req) || !body.includes('"withFacets":true') || !body.includes('"offset":0')) return route.fallback();
    return answerListSearch(route, { hits: listed, total: listed.length, backend: "meilisearch", configured: true, searchId: "journey-remote-scope" });
  });
  await page.goto("/jobs?view=search&sort=fit");
  const place = (company: string) => page.getByTestId("job-row").filter({ hasText: company }).getByTestId("job-location");
  await expect(place("Cedar Relay")).toBeVisible({ timeout: 45_000 });
  await expect(place("Cedar Relay")).toHaveText("Remote (North America)");
  await expect(place("Cedar Relay")).toHaveAttribute("title", "The posting says: “You can work from anywhere in North America.”");
  await expect(place("Harbor Stack")).toHaveText("Remote (Canada)");
  // A posting that names no place keeps plain "Remote", with no claim and no line.
  await expect(place("Driftwood Apps")).toHaveText("Remote");
  await expect(place("Driftwood Apps")).not.toHaveAttribute("title", /.+/);
  expect(diagnostics.pageErrors).toEqual([]);
});

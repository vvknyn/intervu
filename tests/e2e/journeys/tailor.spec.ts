import type { Page } from "@playwright/test";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { LOCAL_AI_RESUME_KEY } from "../../../src/lib/local-ai/resume-storage";
import { expect, test } from "./fixtures";
import { answerListSearch, isListSearch } from "./list-search";

/**
 * Journeys for tailoring a résumé to one role — see tests/journeys/CATALOG.md (J-RESUME-50).
 * Read-only: the résumé lives in localStorage, the search and the posting are answered in the browser,
 * and the draft is tailored on this device.
 *
 * Vivek 2026-10-10: "only the skill section is tweaked for a job ... there could be other updates like
 * wordings for their job experiences". The rules draft now rewords the summary and lines in the
 * posting's words, puts the lines and skills the posting asks for first, and lists each change with
 * Undo; Copy and Download use the changes left on.
 */

/** Fabricated nurse (no real person). */
const NURSE_RESUME = {
  profile: { name: "Priya Nair", profession: "Registered Nurse", yearsOfExperience: 6, location: "Toronto, ON", email: "priya.nair.e2e@example.com", phone: "" },
  experience: [
    {
      id: "exp1",
      company: "Lakeshore General Hospital",
      role: "Registered Nurse, Medical-Surgical",
      dates: "2019 - Present",
      description: [
        "• Assessed and cared for 6 patients per shift on a 32-bed unit",
        "• Charted all assessments and medication administration in Epic",
        "• Precept new graduate nurses through their first twelve weeks on the unit",
      ].join("\n"),
    },
  ],
  competencies: [{ category: "Clinical", skills: ["Medication Administration", "IV Therapy", "Wound Care", "Patient Education"] }],
  education: [{ id: "edu1", degree: "BScN, Nursing", institution: "Lakeshore University", year: "2019" }],
  generatedSummary: "Registered nurse with 6 years of acute care experience on busy medical units.",
};

/** A posting that asks to "document" and "mentor" where the résumé says "Charted" and "Precept". */
const ICU_POSTING = {
  id: "22222222-0000-4000-8000-000000000050",
  title: "Registered Nurse - ICU",
  company: "Harbourview Health",
  company_domain: null,
  location: "Toronto, ON",
  location_city: "Toronto",
  location_state: "Ontario",
  location_country: "Canada",
  work_type: "onsite",
  description:
    "Provide patient education, IV therapy and wound care to critically ill patients. Document assessments and care in the electronic record. Mentor new nurses joining the ICU team.",
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
};

const ANSWER = { hits: [ICU_POSTING], total: 1, backend: "meilisearch", configured: true, searchId: "journey-tailor" };

async function openCustomize(page: Page) {
  await page.addInitScript(
    ([onboardingKey, resumeKey, resume]) => {
      localStorage.setItem(onboardingKey as string, "1");
      localStorage.setItem(resumeKey as string, JSON.stringify({ data: resume, updatedAt: new Date().toISOString(), sourceLabel: "e2e-synthetic" }));
      // Copy writes here, so the journey can read what would land on the clipboard.
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async (text: string) => void ((window as unknown as { __copied?: string }).__copied = text) },
      });
    },
    [ONBOARDING_COMPLETED_STORAGE_KEY, LOCAL_AI_RESUME_KEY, NURSE_RESUME] as const,
  );
  await page.route("**/*", async (route) => {
    const req = route.request();
    if (isListSearch(req)) return answerListSearch(route, ANSWER);
    if (new URL(req.url()).pathname === `/api/jobs/${ICU_POSTING.id}/description`) return route.fulfill({ json: ANSWER });
    return route.fallback();
  });
  await page.goto("/jobs?view=search&q=nurse");
  await page.getByTestId("job-row").getByTestId("job-title").filter({ hasText: ICU_POSTING.title }).first().click({ timeout: 45_000 });
  await page.locator('[data-testid="local-customize-open"]:visible').first().click({ timeout: 15_000 });
  // By name: on a phone the role itself is open in a sheet, which is a dialog too.
  const dialog = page.getByRole("dialog", { name: "Your résumé is ready. Customize for this role." });
  await dialog.getByRole("button", { name: "Use a rules draft" }).click();
  return dialog;
}

test("a rules draft rewords the summary and lines in the posting's words, puts what it asks for first, and each change can be undone", { tag: ["@J-RESUME-50"] }, async ({ page, diagnostics }) => {
  const dialog = await openCustomize(page);
  const changes = dialog.getByTestId("tailor-change");
  await expect(changes).toHaveCount(5, { timeout: 30_000 });
  await expect(dialog.getByTestId("tailor-changes-count")).toContainText("5 of 5 changes on.");

  const summary = dialog.locator('[data-change-kind="summary"]');
  await expect(summary).toContainText("Core skills include Patient Education, IV Therapy and Wound Care.");
  await expect(summary).toContainText(`Was: ${NURSE_RESUME.generatedSummary}`);

  // Rows by position (summary, the role's lines in résumé order, its line order, skills): an undone row drops its "Was:".
  const charted = changes.nth(1);
  await expect(charted).toContainText("Was: Charted all assessments and medication administration in Epic");
  await expect(charted).toContainText("Documented all assessments and medication administration in Epic");
  await expect(charted.locator("mark")).toHaveText(["Documented"]);
  await expect(charted).toContainText("Uses the posting's words: “document”.");
  const precept = dialog.locator('[data-change-kind="line"]').filter({ hasText: "Was: Precept new graduate nurses" });
  await expect(precept).toContainText("Mentor new graduate nurses through their first twelve weeks on the unit");

  await expect(dialog.locator('[data-change-kind="order"]')).toContainText("Now first: Mentor new graduate nurses");
  await expect(dialog.locator('[data-change-kind="skills"]')).toContainText("Wound Care, Patient Education, IV Therapy, Medication Administration");

  // Undo one rewording: the résumé's own line comes back, and Copy uses it with every other change still on.
  await charted.getByTestId("tailor-change-toggle").click();
  await expect(charted).toHaveAttribute("data-undone", "true");
  await expect(charted).toContainText("Charted all assessments and medication administration in Epic");
  await expect(dialog.getByTestId("tailor-changes-count")).toContainText("4 of 5 changes on.");
  await dialog.getByTestId("local-customize-copy").click();
  await expect(dialog.getByTestId("local-customize-copy")).toHaveText("Copied");
  const copied = await page.evaluate(() => (window as unknown as { __copied?: string }).__copied ?? "");
  expect(copied).toContain("Charted all assessments and medication administration in Epic");
  expect(copied).not.toContain("Documented all assessments");
  expect(copied).toContain("Mentor new graduate nurses through their first twelve weeks on the unit");
  expect(copied).toContain("Core skills include Patient Education, IV Therapy and Wound Care.");
  // The lines the posting asks for come first in what is copied too.
  expect(copied.indexOf("Mentor new graduate nurses")).toBeLessThan(copied.indexOf("Assessed and cared for 6 patients"));

  // Redo puts it back.
  await charted.getByTestId("tailor-change-toggle").click();
  await expect(charted).toHaveAttribute("data-undone", "false");
  await expect(dialog.getByTestId("tailor-changes-count")).toContainText("5 of 5 changes on.");

  // The draft never replaces the résumé it tailors from.
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), LOCAL_AI_RESUME_KEY);
  expect(stored?.data?.experience?.[0]?.description).toBe(NURSE_RESUME.experience[0].description);
  expect(stored?.data?.generatedSummary).toBe(NURSE_RESUME.generatedSummary);
  expect(diagnostics.pageErrors).toEqual([]);
});

import type { Page } from "@playwright/test";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { LOCAL_AI_CONSENT_KEY } from "../../../src/lib/local-ai/consent";
import { LOCAL_AI_RESUME_KEY } from "../../../src/lib/local-ai/resume-storage";
import { expect, test } from "./fixtures";
import { answerListSearch, isListSearch } from "./list-search";

/**
 * Journeys for tailoring a résumé to one role — see tests/journeys/CATALOG.md (J-RESUME-50, J-RESUME-52).
 * Read-only: the résumé lives in localStorage, the search and the posting are answered in the browser,
 * and the draft is tailored on this device.
 *
 * Vivek 2026-10-10: "only the skill section is tweaked for a job ... there could be other updates like
 * wordings for their job experiences". The rules draft now rewords the summary and lines in the
 * posting's words, puts the lines and skills the posting asks for first, and lists each change with
 * Undo; Copy and Download use the changes left on.
 *
 * Vivek 2026-10-10, shown a Claude rewrite: "there must be something we could hack together to let the
 * on device models be as effective". With on-device AI on, the model rewrites one line at a time toward
 * the posting sentence it answers; a rewrite that borrows the posting's words waits for the person's
 * OK, and a project the posting asks nothing about is offered to leave out.
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

type Posting = typeof ICU_POSTING;

/** Search for `query`, open `posting`, and open Customize on it with `resume` on this device. */
async function openCustomizeFor(page: Page, resume: object, posting: Posting, query: string) {
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
    [ONBOARDING_COMPLETED_STORAGE_KEY, LOCAL_AI_RESUME_KEY, resume] as const,
  );
  const answer = { hits: [posting], total: 1, backend: "meilisearch", configured: true, searchId: "journey-tailor" };
  await page.route("**/*", async (route) => {
    const req = route.request();
    if (isListSearch(req)) return answerListSearch(route, answer);
    if (new URL(req.url()).pathname === `/api/jobs/${posting.id}/description`) return route.fulfill({ json: answer });
    return route.fallback();
  });
  await page.goto(`/jobs?view=search&q=${query}`);
  await page.getByTestId("job-row").getByTestId("job-title").filter({ hasText: posting.title }).first().click({ timeout: 45_000 });
  await page.locator('[data-testid="local-customize-open"]:visible').first().click({ timeout: 15_000 });
  // By name: on a phone the role itself is open in a sheet, which is a dialog too.
  return page.getByRole("dialog", { name: "Your résumé is ready. Customize for this role." });
}

async function openCustomize(page: Page) {
  const dialog = await openCustomizeFor(page, NURSE_RESUME, ICU_POSTING, "nurse");
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

/** Fabricated warehouse supervisor (no real person): tailoring works the same in any field. */
const WAREHOUSE_RESUME = {
  profile: { name: "Marco Bianchi", profession: "Warehouse Supervisor", yearsOfExperience: 8, location: "Mississauga, ON", email: "marco.e2e@example.com", phone: "" },
  experience: [
    {
      id: "exp1",
      company: "Northgate Distribution",
      role: "Warehouse Supervisor",
      dates: "2018 - Present",
      description: [
        "• Led a crew of 12 pickers across two shifts to hit shipping deadlines",
        "• Improved picking accuracy by rebuilding the slotting plan",
        "• Trained new hires on forklift safety and the WMS scanners",
      ].join("\n"),
    },
  ],
  projects: [{ id: "proj1", company: "Eastside Community Garden", role: "Volunteer coordinator", dates: "2020 - Present", description: "• Built raised beds and ran the spring seed swap" }],
  competencies: [{ category: "Operations", skills: ["Forklift", "Inventory Control", "Shipping and Receiving", "Team Leadership"] }],
  education: [{ id: "edu1", degree: "Diploma, Supply Chain Management", institution: "Sheridan College", year: "2016" }],
  generatedSummary: "Warehouse supervisor with 8 years in distribution centres, focused on safe and accurate shipping.",
};

const DC_POSTING: Posting = {
  ...ICU_POSTING,
  id: "22222222-0000-4000-8000-000000000051",
  title: "Distribution Centre Lead",
  company: "Harbourline Logistics",
  location: "Mississauga, ON",
  location_city: "Mississauga",
  description:
    "Lead a team of warehouse associates across shifts to meet daily shipping targets. Improve picking accuracy and inventory control in the warehouse management system. Train and coach associates on safety procedures.",
};

/** What the stand-in for Chrome's built-in model answers, per résumé line, in a small model's style. */
const MODEL_ANSWERS: Record<string, string> = {
  // The résumé's own words, safety first: on.
  "Trained new hires on forklift safety and the WMS scanners": "Trained new hires on safety for the forklift and the WMS scanners",
  // Borrows the posting's "meet daily shipping targets": offered, off until the person says it's true.
  "Led a crew of 12 pickers across two shifts to hit shipping deadlines": "Led a team of 12 pickers across two shifts to meet daily shipping targets",
  // A figure the résumé doesn't have: never shown.
  "Improved picking accuracy by rebuilding the slotting plan": "Improved picking accuracy by 30% by rebuilding the slotting plan",
};
const MODEL_SUMMARY =
  "Warehouse supervisor with 8 years in distribution centres who led a crew of 12 pickers across two shifts and trained new hires on forklift safety.";

test("on-device AI rewrites each line toward what the posting asks, waits for an OK on the posting's own words, and offers to leave out an unrelated project", { tag: ["@J-RESUME-52"] }, async ({ page, diagnostics }) => {
  await page.addInitScript(
    ([consentKey, answers, summary]) => {
      localStorage.setItem(consentKey as string, "1");
      // A stand-in for Chrome's Prompt API: answers each line prompt from `answers`, once the test lets it.
      const w = window as unknown as { __prompts: string[]; __go: () => void; LanguageModel: unknown };
      let go!: () => void;
      const started = new Promise<void>((resolve) => (go = resolve));
      w.__prompts = [];
      w.__go = () => go();
      const session = {
        async prompt(prompt: string) {
          w.__prompts.push(prompt);
          await started;
          const line = /The résumé line: "(.*)"\n/.exec(prompt)?.[1];
          if (line !== undefined) return (answers as Record<string, string>)[line] ?? "";
          return /The current summary:/.test(prompt) ? (summary as string) : "";
        },
        async clone() {
          return session;
        },
        destroy() {},
      };
      w.LanguageModel = { create: async () => session };
    },
    [LOCAL_AI_CONSENT_KEY, MODEL_ANSWERS, MODEL_SUMMARY] as const,
  );
  const dialog = await openCustomizeFor(page, WAREHOUSE_RESUME, DC_POSTING, "warehouse");
  // One line at a time, and it says how far it has got.
  await expect(dialog.getByText("Rewriting 1 of 4 on this device")).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => (window as unknown as { __go: () => void }).__go());

  const changes = dialog.getByTestId("tailor-change");
  await expect(changes).toHaveCount(5, { timeout: 30_000 });
  await expect(dialog.getByText("On-device · Nano")).toBeVisible();
  await expect(dialog.getByTestId("tailor-changes-count")).toContainText("3 of 5 changes on.");
  const prompts = await page.evaluate(() => (window as unknown as { __prompts: string[] }).__prompts);
  expect(prompts.filter((p) => p.includes("The résumé line:"))).toHaveLength(3);
  expect(prompts.find((p) => p.includes("Trained new hires"))).toContain('The posting asks: "Train and coach associates on safety procedures."');

  const summary = dialog.locator('[data-change-kind="summary"]');
  await expect(summary).toContainText(MODEL_SUMMARY);
  await expect(summary).toContainText(`Was: ${WAREHOUSE_RESUME.generatedSummary}`);
  await expect(summary).toContainText("Rewritten on this device from your lines that answer 3 of the posting's asks.");

  const trained = dialog.locator('[data-change-kind="line"]').filter({ hasText: "Was: Trained new hires on forklift safety" });
  await expect(trained).toHaveAttribute("data-undone", "false");
  await expect(trained).toContainText("Trained new hires on safety for the forklift and the WMS scanners");
  await expect(trained).toContainText("Rewritten on this device to answer the posting's “Train and coach associates on safety procedures”.");

  // The posting's words wait for the person: shown with what they'd add, off until "Use".
  const led = dialog.locator('[data-change-kind="line"]').filter({ hasText: "Was: Led a crew of 12 pickers" });
  await expect(led).toHaveAttribute("data-undone", "true");
  await expect(led).toContainText("Led a team of 12 pickers across two shifts to meet daily shipping targets");
  await expect(led).toContainText("Adds the posting's “meet”, “daily”, “targets”: use it only if that's true.");
  await expect(led.getByTestId("tailor-change-toggle")).toHaveText("Use");

  // A rewrite with a figure the résumé doesn't have is never shown.
  await expect(dialog.getByText("by 30%")).toHaveCount(0);

  const garden = dialog.locator('[data-change-kind="leave-out"]');
  await expect(garden).toContainText("Still in this version. Leave it out?");
  await expect(garden.getByTestId("tailor-change-toggle")).toHaveText("Leave out");

  // Off, neither is in what Copy gives.
  await dialog.getByTestId("local-customize-copy").click();
  const copied = () => page.evaluate(() => (window as unknown as { __copied?: string }).__copied ?? "");
  expect(await copied()).toContain("Led a crew of 12 pickers across two shifts to hit shipping deadlines");
  expect(await copied()).toContain("Eastside Community Garden");
  expect(await copied()).toContain("Trained new hires on safety for the forklift and the WMS scanners");

  // Turned on, both are.
  await led.getByTestId("tailor-change-toggle").click();
  await expect(led).toHaveAttribute("data-undone", "false");
  await expect(led.getByTestId("tailor-change-toggle")).toHaveText("Undo");
  await garden.getByTestId("tailor-change-toggle").click();
  await expect(garden).toContainText("Left out of this version.");
  await expect(dialog.getByTestId("tailor-changes-count")).toContainText("5 of 5 changes on.");
  await expect(dialog.getByTestId("local-customize-copy")).toHaveText("Copy");
  await dialog.getByTestId("local-customize-copy").click();
  await expect.poll(copied).toContain("Led a team of 12 pickers across two shifts to meet daily shipping targets");
  expect(await copied()).not.toContain("Eastside Community Garden");
  expect(await copied()).not.toContain("hit shipping deadlines");

  // The résumé it tailors from is untouched.
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), LOCAL_AI_RESUME_KEY);
  expect(stored?.data?.experience?.[0]?.description).toBe(WAREHOUSE_RESUME.experience[0].description);
  expect(stored?.data?.projects).toHaveLength(1);
  expect(diagnostics.pageErrors).toEqual([]);
});

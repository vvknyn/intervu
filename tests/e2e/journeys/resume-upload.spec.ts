import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { PACKS_HOME_INTRO_KEY } from "../../../src/lib/jobs/for-you/packs-home-intro";
import { expect, test } from "./fixtures";
import { signedInTest, withoutMockSignInHydration } from "./signed-in";

/**
 * The résumé importer every upload goes through (/resume, the /jobs "Rank jobs
 * by your résumé" dialog, setup's résumé step, a company page's Check my fit).
 * See tests/journeys/CATALOG.md (J-RESUME-08, J-RESUME-42..44, J-RESUME-51). Read-only: the
 * résumé is read in the browser and stays in it.
 *
 * 2026-10-07: the primary started a ~494 MB model download, a real résumé the
 * quick read half understood was held at "Confidence is 74%, needs to be
 * above 90" with no way on, and a model already on the device could spin on
 * "Reading your résumé" for good.
 */

const WORD = path.join(__dirname, "../../fixtures/resume-word/maya-okonkwo.docx");
// The same résumé saved as PDF by LibreOffice: embedded subset fonts, a real text layer.
const WORD_PDF = path.join(__dirname, "../../fixtures/resume-word/maya-okonkwo.pdf");

// Invented people (tests/fixtures/resume-corpus): a warehouse worker's résumé saved as pictures of
// its page, no text layer at all; an accountant's in a two-column template, with contact, skills
// and school down a sidebar.
const SCAN = path.join(__dirname, "../../fixtures/resume-corpus/pdf/warehouse-ca.scan.pdf");
const TWO_COLUMN = path.join(__dirname, "../../fixtures/resume-corpus/pdf/accountant-ca.two-column.pdf");

// One job, a headline from it, no skills section: the quick read scores 74.
const PARTLY_READ = `Priya Raman
priya.raman@example.com | Toronto, ON

WORK HISTORY
Northwind Logistics | Operations Lead | Mar 2019 – Present
Ran the overnight dispatch floor for 40 drivers and cut late deliveries by a third.
Rebuilt the weekly shift plan so every route had a backup driver.
`;

// A valid PDF whose one page draws nothing: what a scan or outlined text looks like to a reader.
const NO_TEXT_PDF = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << >> >> endobj
4 0 obj << /Length 0 >>
stream

endstream
endobj
xref
0 5
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000226 00000 n
trailer << /Size 5 /Root 1 0 R >>
startxref
280
%%EOF`;

/** Model consent already given, and a Chrome built-in model that loads at once and then never answers. */
const hangingModel = (page: Page) =>
  page.addInitScript(() => {
    localStorage.setItem("velai.localAi.consent", "1");
    (window as unknown as Record<string, unknown>).LanguageModel = {
      create: async () => ({ prompt: () => new Promise<string>(() => {}) }),
    };
  });

/** Model consent already given, and a Chrome built-in model that loads at once; counts what it is asked to read. */
const countingModel = (page: Page) =>
  page.addInitScript(() => {
    localStorage.setItem("velai.localAi.consent", "1");
    const w = window as unknown as Record<string, unknown>;
    w.__modelPrompts = 0;
    w.LanguageModel = {
      create: async () => ({
        prompt: () => {
          w.__modelPrompts = (w.__modelPrompts as number) + 1;
          return new Promise<string>(() => {});
        },
      }),
    };
  });

const YEAR = new Date().getFullYear();
// Invented. 13 years in all: 5 as a Technical Account Manager after leading a team and 5 in engineering.
const CAREER_CHANGER = `Jordan Ellis
Technical Account Manager
jordan.ellis@example.com | (416) 555-0142 | Toronto, ON

PROFESSIONAL SUMMARY
Technical account manager with a software engineering background, keeping enterprise customers live on integrations and APIs.

PROFESSIONAL EXPERIENCE
Technical Account Manager
Northwind Health | January ${YEAR - 5} — Present
- Own 30 enterprise accounts through onboarding, renewals and escalations.
- Cut integration tickets by a third with a self-serve API checklist.

Team Lead
Brightline Software | June ${YEAR - 8} — December ${YEAR - 6}
- Led a team of six engineers shipping the billing platform.

Senior Software Engineer
Brightline Software | January ${YEAR - 13} — May ${YEAR - 8}
- Built REST APIs and data pipelines in Python and SQL.

SKILLS
Technical: REST APIs, SQL, Python, Salesforce, Jira
Customer: Onboarding, Renewals, Escalations

EDUCATION
Bachelor of Engineering, Computer Engineering, University of Waterloo, ${YEAR - 14}
`;

/** Every matching field's value, in order. */
const valuesOf = (fields: Locator) => fields.evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));

/** Counts every request for model weights, so a test can prove none was made. */
function watchModelDownloads(page: Page): string[] {
  const hits: string[] = [];
  page.on("request", (req) => {
    const host = new URL(req.url()).hostname;
    if (host === "huggingface.co" || host.endsWith(".hf.co") || host.endsWith("huggingface.co")) hits.push(req.url());
  });
  return hits;
}

async function openImporter(page: Page) {
  await page.goto("/resume");
  await page.getByTestId("resume-signed-out-upload").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

for (const [label, file] of [
  ["a Word file", WORD],
  ["a text PDF", WORD_PDF],
] as const) {
  test(`Read my résumé reads ${label} on this device at once, with no model download, and saves it`, { tag: ["@J-RESUME-42"] }, async ({ page, diagnostics }) => {
    const downloads = watchModelDownloads(page);
    const dialog = await openImporter(page);

    // The model is offered with its size, never started by the primary.
    await expect(dialog.getByTestId("resume-import-use-model")).toBeVisible();
    const primary = dialog.getByTestId("resume-import-parse-primary");
    await expect(primary).toHaveText(/Read my résumé/);

    await dialog.locator('input[type="file"]').setInputFiles(file);
    await expect(dialog.getByText(path.basename(file))).toBeVisible();
    await primary.click();

    await expect(dialog.getByRole("button", { name: "Back" })).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue("Maya Okonkwo");
    await expect(dialog.getByLabel("Job title", { exact: true })).toHaveValue("Marketing Manager");
    await expect(dialog.getByTestId("resume-model-strip")).toHaveCount(0);
    await expect(dialog.getByTestId("resume-import-missing")).toHaveCount(0);

    const confirm = dialog.locator('[data-slot="dialog-footer"]').getByRole("button").last();
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(page.getByText("Local résumé on this device")).toBeVisible();
    expect(downloads, "no model weights fetched").toEqual([]);
    expect(diagnostics.pageErrors).toEqual([]);
  });
}

test("A résumé the quick read only partly understands names what it couldn't find and still goes on", { tag: ["@J-RESUME-08"] }, async ({ page, diagnostics }) => {
  const dialog = await openImporter(page);
  await dialog.getByRole("tab", { name: /Paste text/ }).click();
  await dialog.locator("#resume-text").fill(PARTLY_READ);
  await dialog.getByTestId("resume-import-parse-primary").click();

  const missing = dialog.getByTestId("resume-import-missing");
  await expect(missing).toBeVisible({ timeout: 15_000 });
  await expect(missing).toHaveAttribute("data-blocked", "false");
  await expect(missing).toContainText("We couldn't find your skills.");
  // The old gate held this at "Confidence is 74%, needs to be above 90".
  await expect(dialog.getByText(/needs to be above/)).toHaveCount(0);

  const confirm = dialog.locator('[data-slot="dialog-footer"]').getByRole("button").last();
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.getByText("Local résumé on this device")).toBeVisible();
  expect(diagnostics.pageErrors).toEqual([]);
});

test("A PDF with no text says so where the person is looking, offers Paste the text instead, and the picker is ready for the same file again", { tag: ["@J-RESUME-43"] }, async ({ page, diagnostics }) => {
  const dialog = await openImporter(page);
  const input = dialog.locator('input[type="file"]');
  await input.setInputFiles({ name: "scanned.pdf", mimeType: "application/pdf", buffer: Buffer.from(NO_TEXT_PDF) });
  await expect(dialog.getByText("scanned.pdf")).toBeVisible();
  // Cleared after each pick: choosing the same file again fires a change.
  await expect(input).toHaveValue("");

  await dialog.getByTestId("resume-import-parse-primary").click();
  const alert = dialog.getByRole("alert");
  // After trying to read the page as a picture, on this device.
  await expect(alert).toContainText("This PDF has no text we can read", { timeout: 45_000 });
  await alert.getByTestId("resume-import-paste-instead").click();
  await expect(dialog.locator("#resume-text")).toBeVisible();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  expect(diagnostics.pageErrors).toEqual([]);
});

test("A scanned résumé, pictures of its pages with no text layer, is read on this device into review with both jobs and the school, from Velai's own files", { tag: ["@J-RESUME-47"] }, async ({ page, diagnostics, baseURL }) => {
  test.setTimeout(90_000);
  // 2026-10-09: a scan, a phone photo saved as PDF or a design tool's outlined text got
  // "This PDF has no text we can read" and the person had to type their résumé in.
  const elsewhere: string[] = [];
  page.on("request", (req) => {
    if (/tesseract|traineddata/i.test(req.url()) && !req.url().startsWith(baseURL ?? "")) elsewhere.push(req.url());
  });
  const downloads = watchModelDownloads(page);
  const dialog = await openImporter(page);
  await dialog.locator('input[type="file"]').setInputFiles(SCAN);
  await dialog.getByTestId("resume-import-parse-primary").click();

  await expect(dialog.getByRole("button", { name: "Back" })).toBeVisible({ timeout: 60_000 });
  await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue("Kwame Mensah");
  await expect(dialog.getByLabel("Job title", { exact: true })).toHaveValue("Warehouse Associate");
  const roles = dialog.getByPlaceholder("Role");
  await expect(roles).toHaveCount(2);
  await expect(roles.nth(1)).toHaveValue("General Labourer");
  await expect(dialog.getByPlaceholder("Company").nth(1)).toHaveValue(/^Peel Packaging/);
  await expect(dialog.getByPlaceholder("Institution").first()).toHaveValue("Cawthra Park Secondary School");
  await expect(dialog.getByTestId("resume-import-missing")).toHaveCount(0);
  const confirm = dialog.locator('[data-slot="dialog-footer"]').getByRole("button").last();
  await expect(confirm).toBeEnabled();
  expect(elsewhere, "OCR files only from our own origin").toEqual([]);
  expect(downloads, "no model weights fetched").toEqual([]);
  expect(diagnostics.pageErrors).toEqual([]);
});

test("A two-column résumé PDF (contact, skills and school down a sidebar) reads both jobs with their employers and the school whole", { tag: ["@J-RESUME-48"] }, async ({ page, diagnostics }) => {
  // 2026-10-09: the second job came back as "MNP LLP @ Calgary" with its title stuck to the
  // job above, and "Bachelor of Commerce," / "Accounting" down the sidebar as two schools.
  const dialog = await openImporter(page);
  await dialog.locator('input[type="file"]').setInputFiles(TWO_COLUMN);
  await dialog.getByTestId("resume-import-parse-primary").click();

  await expect(dialog.getByRole("button", { name: "Back" })).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue("Priyanka Desai");
  await expect(dialog.getByLabel("Job title", { exact: true })).toHaveValue("Senior Accountant");
  expect(await valuesOf(dialog.getByPlaceholder("Role"))).toEqual(["Senior Accountant", "Staff Accountant"]);
  expect(await valuesOf(dialog.getByPlaceholder("Company"))).toEqual(["Prairie Energy Partners", "MNP LLP"]);
  expect(await valuesOf(dialog.getByPlaceholder("Degree"))).toEqual(["Bachelor of Commerce, Accounting"]);
  expect(await valuesOf(dialog.getByPlaceholder("Institution"))).toEqual(["University of Calgary"]);
  await expect(dialog.getByTestId("resume-import-missing")).toHaveCount(0);
  expect(diagnostics.pageErrors).toEqual([]);
});

test("An on-device model that never finishes reading leaves the quick match within 30 s, and the résumé can be used meanwhile", { tag: ["@J-RESUME-44"] }, async ({ page, diagnostics }) => {
  test.setTimeout(90_000);
  // What "Reading your résumé with the on-device model" spinning for good was.
  // A résumé the quick read only partly gets: the model is only asked to read those (J-RESUME-51).
  await hangingModel(page);
  const dialog = await openImporter(page);
  await expect(dialog.getByTestId("resume-import-model-on")).toBeVisible();
  await dialog.locator('input[type="file"]').setInputFiles({ name: "Priya_Raman_Resume.txt", mimeType: "text/plain", buffer: Buffer.from(PARTLY_READ) });
  await dialog.getByTestId("resume-import-parse-primary").click();

  const strip = dialog.getByTestId("resume-model-strip");
  await expect(strip).toHaveAttribute("data-stage", "reading", { timeout: 15_000 });
  const confirm = dialog.locator('[data-slot="dialog-footer"]').getByRole("button").last();
  await expect(confirm).toBeEnabled();

  await expect(strip).toHaveAttribute("data-phase", "slow", { timeout: 40_000 });
  await expect(strip).toContainText("The on-device model was taking too long, so we kept the quick match.");
  await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue("Priya Raman");
  await expect(confirm).toBeEnabled();
  expect(diagnostics.pageErrors).toEqual([]);
});

signedInTest("Signed in with a résumé on file, Replace on For you opens Rank jobs by your résumé, and a partly read résumé ranks with no confidence gate or endless model spinner", { tag: ["@J-RESUME-46"] }, async ({ page, diagnostics }) => {
  test.setTimeout(120_000);
  // Vivek 2026-10-08 on velai.app/jobs, ranked against an earlier résumé: Replace showed
  // "Manual edit required 56%", "Confidence is 56%, needs to be above 90" and a model
  // spinner whose only way out was a small Skip link.
  await page.addInitScript(
    ([onboardingKey, introKey]) => {
      localStorage.setItem(onboardingKey, "1");
      localStorage.setItem(introKey, "1");
      localStorage.setItem("velai.localAi.enabled", "1");
      if (localStorage.getItem("velai.localAi.resume")) return;
      const resume = {
        profile: { name: "Sam Rivera", profession: "Software Engineer", yearsOfExperience: 4, location: "Toronto, Ontario, Canada", email: "sam.rivera.dev@example.com", phone: "", linkedin: "", website: "" },
        experience: [{ id: "exp1", company: "Nimbus Data", role: "Software Engineer", dates: "2021 - Present", description: "Built backend services in TypeScript." }],
        competencies: [{ category: "Languages", skills: ["TypeScript", "SQL"] }],
        education: [],
        generatedSummary: "",
      };
      localStorage.setItem("velai.localAi.resume", JSON.stringify({ data: resume, updatedAt: new Date().toISOString(), sourceLabel: "Sam_Rivera_Resume.pdf" }));
    },
    [ONBOARDING_COMPLETED_STORAGE_KEY, PACKS_HOME_INTRO_KEY] as const,
  );
  await hangingModel(page);
  await page.goto("/jobs?view=for-you");

  const inUse = page.getByTestId("today-resume-in-use");
  await expect(inUse.getByTestId("today-resume-in-use-label")).toHaveText("Sam_Rivera_Resume.pdf", { timeout: 30_000 });
  await inUse.getByTestId("today-replace-resume").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Rank jobs by your résumé" })).toBeVisible();

  await dialog.locator('input[type="file"]').setInputFiles({ name: "Priya_Raman_Resume.txt", mimeType: "text/plain", buffer: Buffer.from(PARTLY_READ) });
  await dialog.getByTestId("resume-import-parse-primary").click();

  const strip = dialog.getByTestId("resume-model-strip");
  await expect(strip).toHaveAttribute("data-stage", "reading", { timeout: 15_000 });
  await expect(dialog.getByTestId("resume-import-missing")).toContainText("We couldn't find your skills.");
  await expect(dialog.getByText(/needs to be above|Manual edit required/)).toHaveCount(0);
  const rank = dialog.getByRole("button", { name: "Rank my jobs" });
  await expect(rank).toBeEnabled();

  await expect(strip).toHaveAttribute("data-phase", "slow", { timeout: 40_000 });
  await expect(dialog.getByTestId("resume-model-skip")).toHaveCount(0);
  await rank.click();
  await expect(dialog).toBeHidden();
  await expect(inUse.getByTestId("today-resume-in-use-label")).toHaveText("Priya_Raman_Resume.txt", { timeout: 30_000 });
  expect(withoutMockSignInHydration(diagnostics.pageErrors)).toEqual([]);
});

test("A résumé the quick read gets fully never waits on the on-device model, and the review shows the level ranking uses and the roles it counts", { tag: ["@J-RESUME-51"] }, async ({ page, diagnostics }) => {
  // Vivek 2026-10-10: a 99% read still spun on "Reading your résumé with the on-device model" ("as though
  // it is still doing work"), and "Years of Experience 13" said nothing of the 5 years in his role that
  // ranking reads his level from.
  await countingModel(page);
  const dialog = await openImporter(page);
  await expect(dialog.getByTestId("resume-import-model-on")).toBeVisible();
  await dialog.locator('input[type="file"]').setInputFiles({ name: "Jordan_Ellis_Resume.txt", mimeType: "text/plain", buffer: Buffer.from(CAREER_CHANGER) });
  await dialog.getByTestId("resume-import-parse-primary").click();

  const strip = dialog.getByTestId("resume-model-strip");
  await expect(strip).toHaveAttribute("data-phase", "not-needed", { timeout: 15_000 });
  await expect(strip).toHaveText("The quick read found everything ranking uses, so the on-device model wasn't needed.");
  await expect(dialog.getByTestId("resume-model-skip")).toHaveCount(0);

  const level = dialog.getByTestId("resume-review-level");
  await expect(level).toContainText("Level used for ranking: Mid level");
  await expect(level).toContainText("From your 5 years as a Technical Account Manager, the role marked below.");
  await expect(level).toContainText("your other roles count toward your 13 years in total, not this level");
  await expect(dialog.getByLabel("Years of experience in total", { exact: true })).toHaveValue("13");
  const counted = dialog.getByTestId("resume-review-counted");
  await expect(counted).toHaveCount(1);
  await expect(counted.locator("xpath=..").getByPlaceholder("Role")).toHaveValue("Technical Account Manager");

  // The level follows the review's edits: ten years in the role is senior, the same as the whole career.
  await dialog.getByPlaceholder("Dates").first().fill(`January ${YEAR - 10} — Present`);
  await expect(level).toContainText("Level used for ranking: Senior level");
  await expect(level).toContainText("From your 13 years of experience.");
  await expect(counted).toHaveCount(0);

  expect(await page.evaluate(() => (window as unknown as Record<string, number>).__modelPrompts), "the model was never asked to read").toBe(0);
  const confirm = dialog.locator('[data-slot="dialog-footer"]').getByRole("button").last();
  await expect(confirm).toBeEnabled();
  expect(diagnostics.pageErrors).toEqual([]);
});

import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { extractText, getDocumentProxy } from "unpdf";
import { WRAPPED_RESUME, buildWrappedResumePdf } from "../../fixtures/wrapped-resume-pdf";
import { LOCAL_AI_RESUME_KEY } from "../../../src/lib/local-ai/resume-storage";
import { LEGACY_DOC_MESSAGE } from "../../../src/lib/resume/extract-file-text";
import { RESUME_PAGE_SUBCOPY_SIGNED_IN } from "../../../src/lib/jobs/resume-privacy-copy";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { measureResumeLayout, type LayoutPage } from "../../../src/lib/resume/layout-profile";
import { expect, test } from "./fixtures";

/**
 * Journeys for /resume — see tests/journeys/CATALOG.md (J-RESUME-*). Read-only:
 * a guest résumé lives in this browser, and every server action a signed-in
 * test depends on is answered in the browser.
 *
 * Signed-in tests use the dev-only `window.__INTERVU_E2E_AUTH__` hook, which a
 * production build ignores, so they skip themselves against any other origin.
 */

const RESUME_TEXT = `Jane Doe
Senior Software Engineer
Toronto, ON | jane@example.com | (416) 555-0100

SUMMARY
Backend engineer with 8 years building payments systems in Go and TypeScript.

EXPERIENCE
Senior Software Engineer | Stripe | 2021 – Present
• Led the ledger migration to Postgres

SKILLS
Go, TypeScript, PostgreSQL

EDUCATION
BSc Computer Science | University of Waterloo | 2016`;

const GUEST_RESUME = {
  data: {
    profile: { name: "Jane Doe", profession: "Senior Software Engineer", yearsOfExperience: 8, location: "Toronto, ON", email: "", phone: "" },
    generatedSummary: "Backend engineer building payments systems.",
    competencies: [{ category: "Skills", skills: ["Go", "TypeScript"] }],
    experience: [{ id: "exp-0", role: "Senior Software Engineer", company: "Stripe", dates: "2021 – Present", description: "Led the ledger migration" }],
    education: [],
  },
  updatedAt: "2026-09-20T00:00:00.000Z",
  sourceLabel: "jane-doe.pdf",
};

const isLocal = (baseURL: string | undefined) => /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseURL ?? "http://localhost:3000");

/** Next server-action response in flight format: `1:` carries the action's return value. */
const flight = (value: unknown) => `0:{"a":"$@1","f":"","q":"","i":true,"b":"development"}\n1:D"$2"\n1:${JSON.stringify(value)}\n`;

/**
 * Sign in with the dev hook and answer the no-argument reads that fail
 * without a session: `unauthorized` stands in for every one that answers
 * "Unauthorized" (the résumé reads), and `hasResume` for the presence check.
 */
async function signIn(page: Page, answers: { unauthorized: unknown; hasResume?: boolean }) {
  await page.addInitScript(
    ([key]) => {
      (window as unknown as Record<string, unknown>).__INTERVU_E2E_AUTH__ = { uid: "u1", email: "jane@example.com", displayName: "Jane Doe" };
      localStorage.setItem(key, "1");
    },
    [ONBOARDING_COMPLETED_STORAGE_KEY],
  );
  await page.route(
    () => true,
    async (route) => {
      const req = route.request();
      if (req.method() !== "POST" || !req.headers()["next-action"]) return route.continue();
      const res = await route.fetch();
      const text = await res.text();
      let body = text;
      if (req.postData() === "[]" && text.includes('"Unauthorized"')) body = flight(answers.unauthorized);
      else if (answers.hasResume !== undefined && req.postData() === "[]" && text.includes('"hasResume":false')) body = flight({ hasResume: answers.hasResume });
      return route.fulfill({ response: res, body });
    },
  );
}

/** fetchResumeSummaryAction's answer for a résumé stored as text. */
const signInWithTextResume = (page: Page) =>
  signIn(page, { unauthorized: { data: { source: "resume_text", resume_text: RESUME_TEXT, updatedAt: "2026-09-20T00:00:00.000Z" } } });

test.afterEach(({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));

test("A guest résumé offers its ranked jobs and can be removed from this device", { tag: ["@J-RESUME-30"] }, async ({ page }) => {
  await page.addInitScript(
    ([key, value]) => {
      if (!sessionStorage.getItem("seeded")) {
        localStorage.setItem(key, value);
        sessionStorage.setItem("seeded", "1");
      }
    },
    [LOCAL_AI_RESUME_KEY, JSON.stringify(GUEST_RESUME)],
  );
  await page.goto("/resume");

  await expect(page.getByText("Local résumé on this device")).toBeVisible();
  await expect(page.getByTestId("resume-see-matches")).toHaveAttribute("href", "/jobs");

  await page.getByTestId("resume-remove-local").click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByTestId("resume-signed-out-upload")).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), LOCAL_AI_RESUME_KEY)).toBeNull();

  await page.reload();
  await expect(page.getByTestId("resume-signed-out-upload")).toBeVisible();
});

test("An old Word .doc file is refused with how to fix it, not a failed read", { tag: ["@J-RESUME-31"] }, async ({ page }) => {
  await page.goto("/resume");
  await page.getByTestId("resume-signed-out-upload").click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[type="file"]').setInputFiles({ name: "resume.doc", mimeType: "application/msword", buffer: Buffer.from("not a zip") });
  await expect(dialog.getByText(LEGACY_DOC_MESSAGE)).toBeVisible();
});

test("A PDF résumé whose lines wrap imports with its summary as one paragraph and its skills whole", { tag: ["@J-RESUME-36"] }, async ({ page }) => {
  await page.goto("/resume");
  await page.getByTestId("resume-signed-out-upload").click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[type="file"]').setInputFiles({ name: "jordan-lee.pdf", mimeType: "application/pdf", buffer: Buffer.from(buildWrappedResumePdf()) });
  await dialog.getByTestId("resume-import-skip-download").click();
  await dialog.getByTestId("resume-import-parse-primary").click();

  // The review step's fields, found by what they hold.
  await expect(dialog.getByRole("button", { name: "Back" })).toBeVisible({ timeout: 30_000 });
  const values = await dialog.locator("input, textarea").evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
  expect(values, "the summary is the whole paragraph, with no break at each printed line").toContain(WRAPPED_RESUME.summary);
  expect(values.join("\n")).toContain("Large-Scale Data Pipelines");
  expect(values.join("\n")).toContain("Event Sourcing (CQRS, Outbox, Sagas)");
});

/** A PDF's paper, margins, type and page count, read the way the importer reads an upload. */
async function layoutOf(bytes: Uint8Array) {
  const pdf = await getDocumentProxy(bytes.slice());
  const pages: LayoutPage[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const pdfPage = await pdf.getPage(n);
    const [x0, y0, x1, y1] = pdfPage.view;
    const content = await pdfPage.getTextContent();
    pages.push({ width: x1 - x0, height: y1 - y0, origin: [x0, y0], items: content.items as LayoutPage["items"], styles: content.styles });
  }
  const layout = measureResumeLayout(pages);
  expect(layout, "a measurable résumé PDF").not.toBeNull();
  return layout!;
}

// Vivek, 2026-10-02: the tailored PDF "is not dense...no tight borders...its not 1 page". Every
// download used one fixed layout (production has no Chromium, so the server print always fell back).
test("A tailored résumé downloads in the layout of the PDF the guest uploaded: same paper, margins, type and page count", { tag: ["@J-RESUME-37"] }, async ({ page, diagnostics }) => {
  // One dense page: 8pt type, 0.32in margins, a Polish name and an arrow the standard PDF fonts can't draw.
  const original = new Uint8Array(readFileSync("tests/fixtures/resume-layouts/marketing-dense-unicode.pdf"));
  await page.addInitScript(([key]) => localStorage.setItem(key, "1"), [ONBOARDING_COMPLETED_STORAGE_KEY]);
  await page.goto("/resume");
  await page.getByTestId("resume-signed-out-upload").click();
  const importer = page.getByRole("dialog");
  await importer.locator('input[type="file"]').setInputFiles({ name: "lucja-wisniewska.pdf", mimeType: "application/pdf", buffer: Buffer.from(original) });
  await importer.getByTestId("resume-import-skip-download").click();
  await importer.getByTestId("resume-import-parse-primary").click();
  await importer.getByRole("button", { name: "Apply to Resume" }).click({ timeout: 30_000 });
  await expect(page.getByText("Local résumé on this device")).toBeVisible();

  await page.goto("/jobs?view=search&q=engineer");
  await page.getByTestId("job-row").getByTestId("job-title").first().click({ timeout: 45_000 });
  await page.locator('[data-testid="local-customize-open"]:visible').first().click({ timeout: 15_000 });
  // By name: on a phone the role itself is open in a sheet, which is a dialog too.
  const customize = page.getByRole("dialog", { name: "Your résumé is ready. Customize for this role." });
  await customize.getByRole("button", { name: "Use a rules draft" }).click();
  const downloadPdf = customize.getByRole("button", { name: "Download PDF" });
  await expect(downloadPdf).toBeVisible({ timeout: 30_000 });
  const [download] = await Promise.all([page.waitForEvent("download"), downloadPdf.click()]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  const tailored = new Uint8Array(readFileSync(await download.path()));

  const want = await layoutOf(original);
  const got = await layoutOf(tailored);
  expect(got.pageCount, "the original's page count").toBe(want.pageCount);
  expect(Math.abs(got.pageWidth - want.pageWidth), "the original's paper").toBeLessThanOrEqual(1);
  expect(Math.abs(got.pageHeight - want.pageHeight), "the original's paper").toBeLessThanOrEqual(1);
  expect(Math.abs(got.marginLeft - want.marginLeft), `left margin ${got.marginLeft} vs ${want.marginLeft}`).toBeLessThanOrEqual(2);
  expect(Math.abs(got.marginTop - want.marginTop), `top margin ${got.marginTop} vs ${want.marginTop}`).toBeLessThanOrEqual(2);
  // Never larger than the original's type; smaller only to keep its page count, and never below 7pt.
  expect(got.bodySize, "body type").toBeLessThanOrEqual(want.bodySize + 0.05);
  expect(got.bodySize, "body type").toBeGreaterThanOrEqual(7);
  expect(got.family).toBe(want.family);

  const { text } = await extractText(tailored.slice(), { mergePages: true });
  expect(text).toContain("Łucja Wiśniewska");
  expect(text).toContain("→");
  expect(diagnostics.pageErrors).toEqual([]);
});

test.describe("signed in (dev-server only)", () => {
  test.beforeEach(({ baseURL }) => {
    test.skip(!isLocal(baseURL), "signed-in /resume needs the dev-only __INTERVU_E2E_AUTH__ hook, which production builds ignore");
  });

  test("A résumé stored as text previews its headline and summary, not its first 300 characters", { tag: ["@J-RESUME-32"] }, async ({ page }) => {
    await signInWithTextResume(page);
    await page.goto("/resume");

    await expect(page.getByText(RESUME_PAGE_SUBCOPY_SIGNED_IN)).toBeVisible();
    const summary = page.getByText("Backend engineer with 8 years building payments systems in Go and TypeScript.");
    await expect(summary).toBeVisible();
    await expect(summary).not.toContainText("jane@example.com");
    await expect(page.getByText("Senior Software Engineer", { exact: true }).first()).toBeVisible();
    // An uncategorized skills list prints plainly, never as ": Go, …".
    await expect(page.getByText("Go, TypeScript, PostgreSQL", { exact: true })).toBeVisible();
  });

  test("A PDF résumé stored one printed line per line previews its summary as one paragraph", { tag: ["@J-RESUME-35"] }, async ({ page }) => {
    // What the old extraction stored for a wrapped PDF: a line per printed line.
    const { text: pages } = await extractText(new Uint8Array(buildWrappedResumePdf()));
    await signIn(page, { unauthorized: { data: { source: "resume_text", resume_text: pages.join("\n\n"), updatedAt: "2026-09-20T00:00:00.000Z" } } });
    await page.goto("/resume");

    await expect(page.getByText(WRAPPED_RESUME.summary, { exact: true })).toBeVisible();
    await expect(page.getByText(/Large-Scale Data Pipelines/).first()).toBeVisible();
    await expect(page.getByText(/Event Sourcing \(CQRS, Outbox, Sagas\)/).first()).toBeVisible();
  });

  test("Back from the editor with unsaved edits asks first; Keep editing stays, Leave closes", { tag: ["@J-RESUME-33"] }, async ({ page }) => {
    await signInWithTextResume(page);
    await page.goto("/resume");
    await page.getByRole("button", { name: /Edit template/ }).click();

    await page.getByRole("button", { name: /Professional Summary/ }).click();
    await page.locator("textarea").first().fill("Rewritten summary that has not been saved.");
    await expect(page.getByText("Unsaved", { exact: true })).toBeVisible();

    await page.getByTestId("resume-editor-back").click();
    const confirm = page.getByRole("dialog");
    await expect(confirm.getByText("Leave without saving?")).toBeVisible();
    await confirm.getByRole("button", { name: "Keep editing" }).click();
    await expect(page.getByTestId("resume-editor-back")).toBeVisible();

    await page.getByTestId("resume-editor-back").click();
    await page.getByRole("dialog").getByRole("button", { name: "Leave without saving" }).click();
    await expect(page.getByRole("button", { name: /Edit template/ })).toBeVisible();
  });

  test("A résumé saved to the account as text ranks /jobs against it instead of asking for an upload", { tag: ["@J-RESUME-34"] }, async ({ page }) => {
    // fetchResumeData sends the stored text; the browser structures it.
    await signIn(page, { unauthorized: { text: RESUME_TEXT, updatedAt: "2026-09-20T00:00:00.000Z" }, hasResume: true });
    await page.goto("/jobs");

    await expect(page.getByTestId("job-packs-hub")).toBeVisible({ timeout: 30_000 });
    // The Today header mounts only once a résumé has loaded and been read into signals.
    await expect(page.getByTestId("today-home")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Add your résumé", { exact: true })).toHaveCount(0);
  });
});

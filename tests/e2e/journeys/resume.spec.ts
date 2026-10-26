import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import { WRAPPED_RESUME, buildWrappedResumePdf } from "../../fixtures/wrapped-resume-pdf";
import { LOCAL_AI_RESUME_KEY } from "../../../src/lib/local-ai/resume-storage";
import { LEGACY_DOC_MESSAGE } from "../../../src/lib/resume/extract-file-text";
import { RESUME_PAGE_SUBCOPY_SIGNED_IN } from "../../../src/lib/privacy-modes";
import { GATE_ATTEMPT_STORAGE_KEY } from "../../../src/lib/auth/gate-attempt";
import { PENDING_ACTION_STORAGE_KEY } from "../../../src/lib/jobs/pending-actions";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { measureResumeLayout, type LayoutPage } from "../../../src/lib/resume/layout-profile";
import { expect, test } from "./fixtures";
import { signInLikeProduction, withActionResult } from "./signed-in";

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

/** A guest with a résumé on this device. */
const seedGuestResume = (page: Page) =>
  page.addInitScript(
    ([key, value]) => {
      if (!sessionStorage.getItem("seeded")) {
        localStorage.setItem(key, value);
        sessionStorage.setItem("seeded", "1");
      }
    },
    [LOCAL_AI_RESUME_KEY, JSON.stringify(GUEST_RESUME)],
  );

/**
 * A visitor who signs up while the page is open: the session is empty until `signUp()`, then names an account that
 * holds no paid month (nothing readable, nothing stored), as a new sign-up does. The page reloads, as it does after
 * an OAuth or passkey sign-up, so the queued click must survive the round trip in sessionStorage.
 */
async function guestWhoSignsUpLater(page: Page, paid?: { serverResume: () => unknown; saved: (args: string) => void }) {
  let signedUp = false;
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: { user: signedUp ? { uid: "journey-new", email: "jane@example.com", displayName: "Jane Doe" } : null }, headers: { "cache-control": "no-store" } }),
  );
  await page.route(
    () => true,
    async (route) => {
      const req = route.request();
      if (req.method() !== "POST" || !req.headers()["next-action"]) return route.fallback();
      const res = await route.fetch();
      const text = await res.text();
      if (signedUp && paid) {
        // A paid account whose stored résumé is older than the one on this device (hasUsableResumeOnFile / fetchPaidStatusAction / fetchResumeSummaryAction / saveResumeData).
        const args = req.postData() ?? "";
        if (args !== "[]") return (paid.saved(args), route.fulfill({ response: res, body: flight({ success: true }) }));
        if (text.includes('"hasResume":false')) return route.fulfill({ response: res, body: flight({ hasResume: true, updatedAt: "2026-01-01T00:00:00.000Z" }) });
        if (text.includes('"paid":false')) return route.fulfill({ response: res, body: flight({ paid: true }) });
        if (text.includes('"Unauthorized"')) return route.fulfill({ response: res, body: flight({ data: paid.serverResume() }) });
      }
      if (signedUp && req.postData() === "[]" && text.includes('"hasResume":false')) return route.fulfill({ response: res, body: flight({ hasResume: false, paywalled: true }) });
      if (signedUp && req.postData() === "[]" && text.includes('"Unauthorized"')) return route.fulfill({ response: res, body: flight({ data: { source: "none", updatedAt: null } }) });
      return route.fulfill({ response: res, body: text });
    },
  );
  return async () => {
    signedUp = true;
    await page.reload();
  };
}

const stored = (page: Page, key: string) => page.evaluate((k) => sessionStorage.getItem(k), key);

for (const [tag, button, name] of [
  ["@J-RESUME-56", "Edit", "A guest's Edit on a device résumé asks them to sign up, then opens the editor on that résumé"],
  ["@J-RESUME-57", "PDF", "A guest's PDF on a device résumé asks them to sign up, then downloads that résumé as a PDF"],
] as const) {
  test(name, { tag: [tag] }, async ({ page }) => {
    await seedGuestResume(page);
    const signUp = await guestWhoSignsUpLater(page);
    await page.goto("/resume");
    await expect(page.getByText("Local résumé on this device")).toBeVisible();

    await page.getByRole("button", { name: button, exact: true }).click();
    // The gate stays: the click opens sign-up and is recorded as an opened gate.
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(await stored(page, GATE_ATTEMPT_STORAGE_KEY), "the open is recorded").not.toBeNull();
    expect(JSON.parse((await stored(page, PENDING_ACTION_STORAGE_KEY))!).action).toEqual({ kind: "resume", payload: button === "PDF" ? "pdf" : "edit" });

    const download = button === "PDF" ? page.waitForEvent("download", { timeout: 45_000 }) : null;
    await signUp();
    if (download) {
      expect((await download).suggestedFilename()).toMatch(/\.pdf$/i);
    } else {
      await expect(page.getByTestId("resume-editor-back")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText("Jane Doe").first()).toBeVisible();
    }
  });
}

test("A paid account with an older saved résumé gets the guest's Edit on the device résumé, and the editor stays open once it is saved", { tag: ["@J-RESUME-59"] }, async ({ page }) => {
  let saved = false;
  const stored = { source: "resume_data", updatedAt: "2026-01-01T00:00:00.000Z", resume_data: { ...GUEST_RESUME.data, profile: { ...GUEST_RESUME.data.profile, name: "Old Saved Name" } } };
  const adopted = { source: "resume_data", updatedAt: GUEST_RESUME.updatedAt, resume_data: GUEST_RESUME.data };
  await seedGuestResume(page);
  const signUp = await guestWhoSignsUpLater(page, { serverResume: () => (saved ? adopted : stored), saved: () => { saved = true; } });
  await page.goto("/resume");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();

  await signUp();
  await expect.poll(() => saved, { timeout: 30_000 }).toBe(true);
  // The device copy is now the account's: the editor opens on it and is still there, not opened on the older copy and then closed by the reload of the section.
  await expect(page.getByTestId("resume-editor-back")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Jane Doe").first()).toBeVisible();
  await expect(page.getByText("Old Saved Name")).toHaveCount(0);
});

test("A guest's Sign up on a device résumé opens sign-up, records the open and queues nothing", { tag: ["@J-RESUME-58"] }, async ({ page }) => {
  await seedGuestResume(page);
  await page.goto("/resume");
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await stored(page, GATE_ATTEMPT_STORAGE_KEY), "the open is recorded").not.toBeNull();
  expect(await stored(page, PENDING_ACTION_STORAGE_KEY)).toBeNull();
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

/** A guest uploads `fixture` (tests/fixtures/resume-layouts) on /resume and applies the parse as their local résumé. */
async function uploadGuestPdf(page: Page, fixture: string): Promise<Uint8Array> {
  const original = new Uint8Array(readFileSync(`tests/fixtures/resume-layouts/${fixture}.pdf`));
  await page.addInitScript(([key]) => localStorage.setItem(key, "1"), [ONBOARDING_COMPLETED_STORAGE_KEY]);
  await page.goto("/resume");
  await page.getByTestId("resume-signed-out-upload").click();
  const importer = page.getByRole("dialog");
  await importer.locator('input[type="file"]').setInputFiles({ name: `${fixture}.pdf`, mimeType: "application/pdf", buffer: Buffer.from(original) });
  await importer.getByTestId("resume-import-parse-primary").click();
  await importer.getByRole("button", { name: "Apply to Resume" }).click({ timeout: 30_000 });
  await expect(page.getByText("Local résumé on this device")).toBeVisible();
  return original;
}

/** From a guest's local résumé: open the first engineering role's Customize dialog with a rules draft ready. */
async function customizeFirstEngineeringRole(page: Page) {
  await page.goto("/jobs?q=engineer");
  await page.getByTestId("job-row").getByTestId("job-title").first().click({ timeout: 45_000 });
  await page.locator('[data-testid="local-customize-open"]:visible').first().click({ timeout: 15_000 });
  // By name: on a phone the role itself is open in a sheet, which is a dialog too.
  return page.getByRole("dialog", { name: "Your résumé is ready. Customize for this role." });
}

/** A guest uploads `fixture` on /resume, customizes the first engineering role with a rules draft and downloads the PDF. */
async function tailoredDownloadOf(page: Page, fixture: string) {
  const original = await uploadGuestPdf(page, fixture);
  const customize = await customizeFirstEngineeringRole(page);
  const downloadPdf = customize.getByRole("button", { name: "Download PDF" });
  await expect(downloadPdf).toBeVisible({ timeout: 30_000 });
  const [download] = await Promise.all([page.waitForEvent("download"), downloadPdf.click()]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  const tailored = new Uint8Array(readFileSync(await download.path()));
  return { original, tailored, want: await layoutOf(original), got: await layoutOf(tailored) };
}

// Vivek, 2026-10-02: the tailored PDF "is not dense...no tight borders...its not 1 page", and it
// must "exactly look like" the uploaded résumé, "1 pager always". Every download used one fixed
// layout (production has no Chromium, so the server print always fell back).
test("A tailored résumé downloads in the layout of the PDF the guest uploaded: same paper, margins, type, one page", { tag: ["@J-RESUME-37"] }, async ({ page, diagnostics }) => {
  // One dense page: 8pt type, 0.32in margins, a Polish name and an arrow the standard PDF fonts can't draw.
  const { tailored, want, got } = await tailoredDownloadOf(page, "marketing-dense-unicode");
  expect(got.pageCount, "one page").toBe(1);
  expect(Math.abs(got.pageWidth - want.pageWidth), "the original's paper").toBeLessThanOrEqual(1);
  expect(Math.abs(got.pageHeight - want.pageHeight), "the original's paper").toBeLessThanOrEqual(1);
  expect(Math.abs(got.marginLeft - want.marginLeft), `left margin ${got.marginLeft} vs ${want.marginLeft}`).toBeLessThanOrEqual(2);
  expect(Math.abs(got.marginTop - want.marginTop), `top margin ${got.marginTop} vs ${want.marginTop}`).toBeLessThanOrEqual(2);
  // Never larger than the original's type; smaller only to fit, and never below 7pt.
  expect(got.bodySize, "body type").toBeLessThanOrEqual(want.bodySize + 0.05);
  expect(got.bodySize, "body type").toBeGreaterThanOrEqual(7);
  expect(got.family).toBe(want.family);

  const { text } = await extractText(tailored.slice(), { mergePages: true });
  expect(text).toContain("Łucja Wiśniewska");
  expect(text).toContain("→");
  expect(diagnostics.pageErrors).toEqual([]);
});

test("A tailored résumé from a three-page CV downloads as one page in its typeface, and the guest is told which bullets were left out", { tag: ["@J-RESUME-38"] }, async ({ page, diagnostics }) => {
  // Three Times pages (11pt, 0.9in margins, eight roles): too long for one page even at its tightest.
  const { tailored, want, got } = await tailoredDownloadOf(page, "civil-engineer-long-3p");
  expect(want.pageCount).toBe(3);
  expect(got.pageCount, "one page, always").toBe(1);
  expect(got.family, "the original's typeface").toBe("serif");
  expect(Math.abs(got.pageWidth - want.pageWidth), "the original's paper").toBeLessThanOrEqual(1);
  // Borders close in to 0.35in at the tightest, and the type stays within 15% of the original's.
  expect(got.marginLeft, "left border").toBeGreaterThanOrEqual(24);
  expect(got.bodySize, "body type").toBeGreaterThanOrEqual(want.bodySize * 0.85 - 0.05);

  // Said where the person is looking, naming the roles that lost a bullet.
  const note = page.getByText(/^To keep it to one page, \d+ bullets? that matters? least for this role (was|were) left out: .+ from .+\. Your résumé still has (it|them)\.$/);
  await expect(note).toBeVisible();
  await expect(note).toBeInViewport();
  const { text } = await extractText(tailored.slice(), { mergePages: true });
  expect(text).toContain("Tomás Herrera-Lindqvist, P.Eng.");
  expect(text, "the newest role's first bullet stays").toContain("interchange rebuild");
  expect(diagnostics.pageErrors).toEqual([]);
});

// Seen while fixing the PDF layout: a CV's Projects section vanished at upload (and with it a
// role dated with a single year), and the person's email domain was taken for their website.
test("A guest's uploaded CV keeps its Projects and a role dated with one year, and Copy never turns their email's domain into a website", { tag: ["@J-RESUME-39"] }, async ({ page, diagnostics }) => {
  await uploadGuestPdf(page, "civil-engineer-long-3p");
  await expect(page.getByText("Open-source culvert sizing calculator")).toBeVisible();
  await expect(page.getByText("Bow River Pathway Bridge (volunteer design review)")).toBeVisible();
  await expect(page.getByText("Survey Technician", { exact: false }).first()).toBeVisible();

  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const customize = await customizeFirstEngineeringRole(page);
  await customize.getByTestId("local-customize-copy").click();
  await expect(customize.getByTestId("local-customize-copy")).toContainText("Copied");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const contactLine = copied.split("\n")[1] ?? "";
  expect(contactLine).toContain("tomas.hl@example.com");
  expect(contactLine, "the email's domain is not a website").not.toMatch(/\|\s*example\.com\b/);
  expect(copied).toContain("Open-source culvert sizing calculator");
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

  test("Replace's Choose file opens the file picker on a click, reads a PDF or Word file into the box, and is ready for the same file again", { tag: ["@J-RESUME-45"] }, async ({ page }) => {
    await signInWithTextResume(page);
    await page.goto("/resume");
    await page.getByRole("button", { name: /Replace/ }).click();

    const choose = page.getByRole("button", { name: "Choose file" });
    const box = page.getByPlaceholder(/Paste your résumé text here/);
    for (const file of ["maya-okonkwo.pdf", "maya-okonkwo.docx"]) {
      // A real click, not a script setting the input: the picker itself opens.
      const [picker] = await Promise.all([page.waitForEvent("filechooser"), choose.click()]);
      await picker.setFiles(path.join(__dirname, "../../fixtures/resume-word", file));
      await expect(page.getByText(file, { exact: true })).toBeVisible();
      await expect(box).toHaveValue(/Maya Okonkwo[\s\S]*Marketing Manager/);
      // Cleared after each pick, so choosing the same file again fires a change.
      await expect(page.locator('input[type="file"]')).toHaveValue("");
    }
    await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  test("An account whose saved résumé needs a paid month sees it is saved, not \"No resume on file\", and is offered pricing, never a blank template", { tag: ["@J-RESUME-55"] }, async ({ page }) => {
    await signIn(page, { unauthorized: { data: { source: "locked", updatedAt: "2026-09-20T00:00:00.000Z" } }, hasResume: false });
    await page.goto("/resume");

    const card = page.getByTestId("settings-resume-locked");
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card.getByText("Your résumé is saved to your account")).toBeVisible();
    await expect(card.getByText("To open or edit it, you need a paid month.")).toBeVisible();
    await expect(card.getByText(/Saved .*2026/)).toBeVisible();
    await expect(card.getByRole("link", { name: "See pricing" })).toHaveAttribute("href", "/pricing");
    await expect(card.getByRole("button", { name: /or upload a PDF or Word file to use on this device/ })).toBeVisible();
    await expect(card.getByRole("button", { name: "Delete" })).toBeVisible();
    await expect(page.getByText("No resume on file")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Edit template/ })).toHaveCount(0);
  });

  test("A résumé saved to the account as text ranks /jobs against it instead of asking for an upload", { tag: ["@J-RESUME-34"] }, async ({ page }) => {
    // fetchResumeData sends the stored text; the browser structures it.
    await signIn(page, { unauthorized: { text: RESUME_TEXT, updatedAt: "2026-09-20T00:00:00.000Z" }, hasResume: true });
    await page.goto("/jobs");

    // The list ranks against the saved résumé: it opens on the fit sort, with the résumé in use named in the strip above the list.
    await expect(page).toHaveURL(/[?&]sort=fit/, { timeout: 30_000 });
    await expect(page.getByTestId("resume-read-strip")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Add your résumé", { exact: true })).toHaveCount(0);
  });

  test("A role opened from a typed search offers Customize with the résumé on file, not an upload", { tag: ["@J-RESUME-49"] }, async ({ page }) => {
    // Nothing on a typed search had loaded the saved résumé, so the role asked
    // an account that has one to "Upload résumé to customize" (validation, 2026-10-09).
    await signIn(page, { unauthorized: { text: RESUME_TEXT, updatedAt: "2026-09-20T00:00:00.000Z" }, hasResume: true });
    await page.goto("/jobs?q=engineer");
    await page.getByTestId("job-row").getByTestId("job-title").first().click({ timeout: 45_000 });

    await expect(page.locator('[data-testid="local-customize-open"]:visible').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="job-detail-upload-to-customize"]:visible')).toHaveCount(0);
  });
});

/** A name no other request carries, so the account save is the request that names it. */
const SAVE_MARK = "Zephyrine Okafor-Lindqvist";
const SAVE_RESUME = RESUME_TEXT.replace("Jane Doe", SAVE_MARK);

test("A signed-in import that doesn't reach the account says so, keeps the résumé in this browser, and Try again sends it again", { tag: ["@J-RESUME-41"] }, async ({ page, diagnostics }) => {
  // The /jobs import ignored a failed save, so the résumé looked saved until
  // the next visit, when it was gone (journey audit). Signed in the way
  // production signs in, the server has no session and refuses the save, as
  // it would after a session expired. The second try is answered as saved;
  // nothing is written anywhere.
  let saves = 0;
  await signInLikeProduction(page, () => undefined);
  // Registered after the sign-in routes, so it sees each request first.
  await page.route(
    () => true,
    async (route) => {
      const req = route.request();
      const body = req.method() === "POST" && req.headers()["next-action"] ? (req.postData() ?? "") : "";
      // The import's own save (a .txt upload saves as "text"). A résumé kept
      // in this browser can also be carried into the account on its own
      // ("pdf", 1); that one gets the server's real answer.
      if (!body.includes(SAVE_MARK) || !/,"text",[\d.]+\]$/.test(body)) return route.fallback();
      saves += 1;
      if (saves === 1) return route.fallback();
      const res = await route.fetch();
      return route.fulfill({ response: res, body: withActionResult(await res.text(), {}) });
    },
  );
  await page.addInitScript((key) => localStorage.setItem(key, "1"), ONBOARDING_COMPLETED_STORAGE_KEY);
  // Setup's "Add your résumé" link for a person with no résumé on file: the importer opens.
  await page.goto("/jobs?resume=setup");
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[type="file"]').setInputFiles({ name: "resume.txt", mimeType: "text/plain", buffer: Buffer.from(SAVE_RESUME) }, { timeout: 60_000 });
  await dialog.getByTestId("resume-import-parse-primary").click();
  await expect(dialog.getByRole("button", { name: "Back" })).toBeVisible({ timeout: 30_000 });
  await dialog.locator('[data-slot="dialog-footer"]').getByRole("button").last().click();

  const notSaved = page.getByRole("alert").filter({ hasText: "Your résumé didn't save to your account" });
  await expect(notSaved).toBeVisible({ timeout: 15_000 });
  expect(saves).toBe(1);
  const keptName = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null")?.data?.profile?.name ?? null, LOCAL_AI_RESUME_KEY);
  expect(await keptName(), "kept in this browser, so the next visit still has it").toBe(SAVE_MARK);
  // It waits for the person instead of closing itself like a passing note.
  await page.waitForTimeout(6_000);
  await expect(notSaved).toBeVisible();

  await notSaved.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Résumé saved to your account." })).toBeVisible({ timeout: 15_000 });
  expect(saves).toBe(2);
  await expect(notSaved).toHaveCount(0);
  // Saved to the account now, so this browser's copy goes.
  await expect.poll(keptName).toBeNull();
  expect(diagnostics.pageErrors).toEqual([]);
});

test("A name line with credentials (\"Amara Okafor, RN\") is the name, and the place below it is the location", { tag: ["@J-RESUME-40"] }, async ({ page, diagnostics }) => {
  // "RN" read like a state code, so the name line became the location, which
  // ranks every list and decides which roles are abroad (résumé PDF thread).
  const text = [
    "Amara Okafor, RN",
    "Hamilton, ON | amara@example.com | (905) 555-0100",
    "",
    "EXPERIENCE",
    "Registered Nurse | Hamilton Health Sciences | 2019 – Present",
    "- Cared for 6 patients a shift on a cardiac unit.",
    "",
    "SKILLS",
    "Patient assessment, Telemetry, Epic",
  ].join("\n");
  await page.goto("/resume");
  await page.getByTestId("resume-signed-out-upload").click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[type="file"]').setInputFiles({ name: "amara.txt", mimeType: "text/plain", buffer: Buffer.from(text) });
  await dialog.getByTestId("resume-import-parse-primary").click();
  await expect(dialog.getByLabel("Location", { exact: true })).toHaveValue("Hamilton, ON", { timeout: 30_000 });
  await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue("Amara Okafor");
  expect(diagnostics.pageErrors).toEqual([]);
});

test("A server that answers 502 to the résumé read shows the load error with Try again, not endless loading", { tag: ["@J-RESUME-60"] }, async ({ page }) => {
  // The web pool's own "Bad gateway" is not an action response, so Next
  // rejects the call on the client; checking `{ error }` alone left the page
  // on "Loading your résumé" for good (Oct 25 stall).
  let reads = 0;
  await signIn(page, { unauthorized: {} });
  await page.route(
    () => true,
    async (route) => {
      const req = route.request();
      if (req.method() !== "POST" || !req.headers()["next-action"] || req.postData() !== "[]") return route.fallback();
      reads += 1;
      return route.fulfill({ status: 502, contentType: "text/plain", body: "Bad gateway" });
    },
  );
  await page.goto("/resume");
  await expect(page.getByText("Couldn't load your résumé.")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  expect(reads, "the read was retried before giving up").toBeGreaterThanOrEqual(4);
});

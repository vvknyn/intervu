import type { Page } from "@playwright/test";
import { LOCAL_AI_RESUME_KEY } from "../../../src/lib/local-ai/resume-storage";
import { LEGACY_DOC_MESSAGE } from "../../../src/lib/resume/extract-file-text";
import { RESUME_PAGE_SUBCOPY_SIGNED_IN } from "../../../src/lib/jobs/resume-privacy-copy";
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

/** Sign in with the dev hook and answer the résumé summary read with a résumé stored as text. */
async function signInWithTextResume(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__INTERVU_E2E_AUTH__ = { uid: "u1", email: "jane@example.com", displayName: "Jane Doe" };
  });
  await page.route(
    () => true,
    async (route) => {
      const req = route.request();
      if (req.method() !== "POST" || !req.headers()["next-action"]) return route.continue();
      const res = await route.fetch();
      const text = await res.text();
      // fetchResumeSummaryAction takes no arguments and answers "Unauthorized" without a session.
      const body =
        req.postData() === "[]" && text.includes("Unauthorized")
          ? flight({ data: { source: "resume_text", resume_text: RESUME_TEXT, updatedAt: "2026-09-20T00:00:00.000Z" } })
          : text;
      return route.fulfill({ response: res, body });
    },
  );
}

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
});

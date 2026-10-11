import { PRIVACY_HEADLINE, PRIVACY_PROMISES } from "../../../src/lib/legal/privacy-promises";
import { expect, test } from "./fixtures";

/**
 * Journeys for velai.app/privacy — see tests/journeys/CATALOG.md (J-CONTENT-30/31/34,
 * and J-JOBS-115, the front door's privacy promises that link here).
 * Read-only. What "Delete account" erases is a promise people act on, so the
 * page has to say what the server action really removes
 * (src/lib/account/erase-account.ts): records kept under the sign-in email and
 * the behavioural-ledger rows stamped with the account id, and the PostHog
 * person, not only the account's own collections.
 */

test("the privacy policy says account deletion also erases records kept under your sign-in email", { tag: ["@J-CONTENT-30"] }, async ({ page, diagnostics }) => {
  await page.goto("/privacy");
  const heading = page.getByRole("heading", { name: "Retention & deletion" });
  await heading.scrollIntoViewIfNeeded();
  await expect(heading).toBeVisible();

  const article = page.locator("article").first();
  await expect(article).toContainText("contact-form messages and connect, founding-seat, and credit-pack waitlist entries");
  await expect(article).toContainText("behavioural-ledger rows in PostgreSQL stamped with your account id");
  await expect(article).not.toContainText("records stored only by email without an account id");
  await expect(article).toContainText("asks PostHog to delete the person tied to your account id");
  await expect(article).not.toContainText("makes no call to PostHog to delete data");
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

test("the privacy policy says account data is encrypted in our own database, not kept in Firestore", { tag: ["@J-CONTENT-31"] }, async ({ page, diagnostics }) => {
  await page.goto("/privacy");
  const article = page.locator("article").first();
  await expect(article).toContainText("This data lives in a PostgreSQL database we run on our own servers.");
  await expect(article).toContainText("Each record is encrypted with AES-256 under a key only we hold before it is stored");
  await expect(article).not.toContainText("This data lives in Google Cloud Firestore");
  await expect(article).not.toContainText("We're moving it onto a PostgreSQL database");
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

test("the privacy policy opens with Velai's résumé promises and a Your résumé section that explains each one", { tag: ["@J-CONTENT-34"] }, async ({ page, diagnostics }) => {
  await page.goto("/privacy");
  const promises = page.getByTestId("privacy-promises");
  await expect(promises).toBeVisible();
  for (const promise of PRIVACY_PROMISES) {
    await expect(promises.locator(`[data-promise="${promise.id}"]`)).toContainText(promise.title);
  }

  const heading = page.getByRole("heading", { name: "Your résumé", exact: true });
  await expect(heading).toBeVisible();
  const article = page.locator("article").first();
  await expect(article).toContainText("The file itself is never uploaded to us");
  await expect(article).toContainText("it is encrypted with AES-256 before it is stored");
  await expect(article).toContainText("Those searches are not logged.");
  await expect(article).toContainText("Every word on the page, labels and tooltips included, is masked before it leaves your browser");
  await expect(article).toContainText("No AI model on our servers reads it.");
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

test("the front door says the résumé stays private in its first screen and links each promise to the policy", { tag: ["@J-JOBS-115"] }, async ({ page, diagnostics }) => {
  await page.goto("/jobs");
  const line = page.getByTestId("front-door-privacy-line");
  await expect(line).toBeVisible({ timeout: 10_000 });
  await expect(line).toContainText(PRIVACY_HEADLINE);
  await expect(line.getByRole("link", { name: "How" })).toHaveAttribute("href", "/privacy#your-resume");

  const promises = page.getByTestId("privacy-promises");
  await promises.scrollIntoViewIfNeeded();
  await expect(promises).toBeVisible();
  await expect(promises.locator("[data-promise]")).toHaveCount(PRIVACY_PROMISES.length);

  await promises.locator('[data-promise="encrypted"] a').click();
  await expect(page).toHaveURL(/\/privacy#your-resume$/);
  await expect(page.getByRole("heading", { name: "Your résumé", exact: true })).toBeInViewport();
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

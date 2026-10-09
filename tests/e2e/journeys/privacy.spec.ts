import { expect, test } from "./fixtures";

/**
 * Journeys for velai.app/privacy — see tests/journeys/CATALOG.md (J-CONTENT-30).
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

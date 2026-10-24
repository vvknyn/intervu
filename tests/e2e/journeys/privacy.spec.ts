import { PRIVACY_HEADLINE, PRIVACY_PROMISES } from "../../../src/lib/legal/privacy-promises";
import { expect, test } from "./fixtures";

/**
 * Journeys for velai.app/privacy — see tests/journeys/CATALOG.md (J-CONTENT-30/31/34/37/39,
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
  await expect(article).toContainText("the copy in Firestore was deleted in October 2026");
  await expect(article).not.toContainText("they stay in Firestore only until it is emptied");
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

test("the front door says the résumé stays private in its first screen and links to the policy", { tag: ["@J-JOBS-115"] }, async ({ page, diagnostics }) => {
  await page.goto("/jobs");
  const line = page.getByTestId("front-door-privacy-line");
  await expect(line).toBeVisible({ timeout: 10_000 });
  await expect(line).toContainText(PRIVACY_HEADLINE);
  // The promises themselves live on the policy page, not in a band on the front door.
  await expect(page.getByTestId("privacy-promises")).toHaveCount(0);
  await line.getByRole("link", { name: "How" }).click();
  await expect(page).toHaveURL(/\/privacy#your-resume$/);
  await expect(page.getByTestId("privacy-promises")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your résumé", exact: true })).toBeInViewport();
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

test("the privacy policy says searches are kept in an anonymous record, apart from your account, and analytics never see the words", { tag: ["@J-CONTENT-37"] }, async ({ page, diagnostics }) => {
  await page.goto("/privacy");
  const article = page.locator("article").first();
  await expect(article).toContainText("We keep an anonymous record of the searches people run");
  await expect(article).toContainText("It holds no account id, IP address or browser id");
  await expect(article).toContainText("deleted after 90 days");
  await expect(article).toContainText("query string and anything after a # removed before it leaves your browser");
  // Where you came from and the tags on the link you followed are not kept either.
  await expect(article).toContainText("the page you came from (the referrer), so none of them is stored with the events");
  await expect(article).toContainText("Tags in a link address (like utm_source or an ad click id) are not kept either");
  await expect(article).toContainText("The Cloudflare Turnstile check on the Velai forms that show it");
  await expect(article).not.toContainText("including the text of what you typed");
  await expect(article).not.toContainText("build a profile of your search activity");
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

test("the privacy policy says the extension proposes résumé changes, applies only the ones you accept, and remembers only which", { tag: ["@J-CONTENT-39"] }, async ({ page, diagnostics }) => {
  await page.goto("/privacy");
  const article = page.locator("article").first();
  await expect(article).toContainText("proposes changes to your résumé for the job inside the extension");
  await expect(article).toContainText("nothing changes until you accept it");
  await expect(article).toContainText("with the changes you accepted for that job");
  // What it keeps in Chrome's storage: marks, never résumé text, and the résumé itself stays out.
  await expect(article).toContainText("which ones, as short codes with none of your résumé's text, for up to 60 days");
  await expect(article).toContainText("It holds the résumé in memory only, never in Chrome's storage");
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

test("the privacy policy says the extension drafts an answer only on a tap, from a few résumé lines without your name or contact details, and inserts it only when you say so", { tag: ["@J-CONTENT-40"] }, async ({ page, diagnostics }) => {
  await page.goto("/privacy");
  const article = page.locator("article").first();
  await expect(article).toContainText("It drafts an answer only when you pick");
  await expect(article).toContainText("never for questions that are yours to answer: work authorization, pay, demographics");
  await expect(article).toContainText("without your name, email, phone number or links");
  await expect(article).toContainText("If sealed AI isn't available or its server can't be verified, nothing is sent");
  await expect(article).toContainText("goes into the form only when you pick");
  // The AI-processing section names what goes to the sealed server for a draft too.
  await expect(article).toContainText("when you ask the Chrome extension to draft an answer to an application question, only that question");
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

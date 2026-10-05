import type { Page, Request } from "@playwright/test";
import { expect, test } from "./fixtures";
import { signInLikeProduction } from "./signed-in";
import { SIGN_OUT_LANDING_PATH } from "../../../src/lib/auth/signout-request";

/**
 * Signing out from the header's account menu (founder report 2026-10-05:
 * "the signout process is also taking for ever").
 *
 * Two causes, one journey each:
 *  - the route waited on WorkOS's API before answering (one recorded sign-out
 *    sat 5 s between the click and the page leaving, 2026-09-23), then sent
 *    the browser to "/", which only redirects to /jobs again;
 *  - the click awaited a lazily loaded file before sending anything, and a tab
 *    opened before a release asks for a file that no longer exists (a
 *    ChunkLoadError on the founder's tab right before that report).
 *
 * Read-only: signed in the way production does (signed-in.ts), so the POST
 * reaches the real route with no session and nothing is revoked.
 */

/** How long after the click the POST may take to leave the page: nothing should stand before it. */
const POST_LEAVES_WITHIN_MS = 1_000;

const isSignOutPost = (req: Request) => req.method() === "POST" && new URL(req.url()).pathname === "/auth/signout";

/** Signed in like production until the sign-out POST goes out, signed out after it. */
async function signInUntilSignOut(page: Page) {
  let signedOut = false;
  page.on("request", (req) => {
    if (isSignOutPost(req)) signedOut = true;
  });
  await signInLikeProduction(page, () => undefined);
  // Registered after, so it answers first once signed out: the landing page asks who is signed in again.
  await page.route("**/api/auth/session", (route) =>
    signedOut
      ? route.fulfill({ json: { user: null }, headers: { "cache-control": "no-store" } })
      : route.fallback(),
  );
  return { isSignedOut: () => signedOut };
}

async function openAccountMenu(page: Page) {
  await expect(page.getByTestId("topbar-avatar")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("topbar-avatar").click();
  const signOut = page.getByRole("menuitem", { name: "Sign out" });
  await expect(signOut).toBeVisible();
  return signOut;
}

/** Clicks Sign out and returns how long the POST took to leave, and the route's answer. */
async function clickSignOut(page: Page, signOut: ReturnType<Page["getByRole"]>) {
  const posted = page.waitForRequest(isSignOutPost, { timeout: 15_000 });
  const answered = page.waitForResponse((res) => isSignOutPost(res.request()), { timeout: 15_000 });
  const clickedAt = Date.now();
  await signOut.click();
  await posted;
  const leftAfterMs = Date.now() - clickedAt;
  const response = await answered;
  return { leftAfterMs, status: response.status(), location: response.headers()["location"] };
}

async function expectLandedSignedOut(page: Page) {
  await page.waitForURL((url) => url.pathname === SIGN_OUT_LANDING_PATH, { timeout: 15_000 });
  await expect(page.getByTestId("topbar-signin")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("topbar-avatar")).toHaveCount(0);
}

test("Sign out from the account menu leaves at once and lands on the job board signed out, in one hop", { tag: ["@J-NAV-12"] }, async ({ page }) => {
  await signInUntilSignOut(page);
  await page.goto("/trends");
  const signOut = await openAccountMenu(page);

  const { leftAfterMs, status, location } = await clickSignOut(page, signOut);
  expect(leftAfterMs, "the sign-out POST leaves the page right after the click").toBeLessThan(POST_LEAVES_WITHIN_MS);
  expect(status).toBe(303);
  expect(new URL(location!, page.url()).pathname, "straight to /jobs, not via /").toBe(SIGN_OUT_LANDING_PATH);
  await expectLandedSignedOut(page);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("Sign out still works on a page opened before a release, whose lazily loaded files are gone", { tag: ["@J-AUTH-56"] }, async ({ page }) => {
  const session = await signInUntilSignOut(page);
  await page.goto("/jobs");
  const signOut = await openAccountMenu(page);

  // A release shipped since this page loaded: every file it hasn't fetched yet
  // is gone, until the sign-out POST leaves and the next page is the new release.
  await page.route("**/_next/static/**", (route) =>
    session.isSignedOut() ? route.fallback() : route.fulfill({ status: 404, body: "" }),
  );

  const { leftAfterMs } = await clickSignOut(page, signOut);
  expect(leftAfterMs, "a missing file never stands before the sign-out POST").toBeLessThan(POST_LEAVES_WITHIN_MS);
  await expectLandedSignedOut(page);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

import type { Page } from "@playwright/test";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { expect, test } from "./fixtures";

/**
 * Journeys for the header nav — see tests/journeys/CATALOG.md (J-NAV-*). Read-only.
 *
 * The For you / Search tabs only render for a signed-in user, and the only
 * sign-in a spec can fake is the dev-only `window.__INTERVU_E2E_AUTH__` hook,
 * which a production build ignores. So this spec runs against a local dev
 * server and skips itself against any other origin.
 */

const FOLLOW = { domain: "acme.com", slug: "acme", displayName: "Acme", createdAt: "2026-09-01T00:00:00.000Z" };
const NEW_JOBS = Array.from({ length: 12 }, (_, i) => ({ id: `j${i}`, title: `Role ${i}`, posted_ts: Date.now() - i * 1000 }));

/** Next server-action response in flight format: `1:` carries the action's return value. */
const flight = (value: unknown) => `0:{"a":"$@1","f":"","q":"","i":true,"b":"development"}\n1:D"$2"\n1:${JSON.stringify(value)}\n`;

async function signInWithFollowAlerts(page: Page) {
  await page.addInitScript(
    ([key]) => {
      (window as unknown as Record<string, unknown>).__INTERVU_E2E_AUTH__ = {
        uid: "u1", displayName: "Ada Lovelace", email: "ada@example.com", emailVerified: true, isAnonymous: false,
        providerData: [], metadata: {}, photoURL: null, phoneNumber: null, providerId: "password", tenantId: null, refreshToken: "x",
      };
      localStorage.setItem(key, "1");
    },
    [ONBOARDING_COMPLETED_STORAGE_KEY],
  );
  await page.route(
    () => true,
    async (route) => {
      const req = route.request();
      if (req.method() !== "POST" || !req.headers()["next-action"]) return route.continue();
      const body = req.postData() ?? "";
      const res = await route.fetch();
      const text = await res.text();
      let out = text;
      if (body === "[]" && text.includes("User not authenticated")) out = flight({ data: [FOLLOW] });
      else if (body.startsWith('["') && body.includes("acme.com")) out = flight({ data: [{ domain: "acme.com", displayName: "Acme", jobs: NEW_JOBS }] });
      return route.fulfill({ response: res, body: out });
    },
  );
}

test.afterEach(({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));

test.beforeEach(({ baseURL }) => {
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseURL ?? "http://localhost:3000");
  test.skip(!local, "signed-in header needs the dev-only __INTERVU_E2E_AUTH__ hook, which production builds ignore");
});

test("header shows For you and Search tabs; clicking one moves aria-current and the URL", { tag: ["@J-NAV-30"] }, async ({ page }) => {
  await signInWithFollowAlerts(page);
  await page.goto("/jobs");
  const header = page.locator('[data-region="header"]');
  const forYou = header.getByTestId("jobs-home-for-you");
  const search = header.getByTestId("jobs-home-search");
  await expect(forYou).toBeVisible();
  await expect(search).toBeVisible();

  await search.click();
  await expect(search).toHaveAttribute("aria-current", "true");
  await expect(forYou).not.toHaveAttribute("aria-current", /.+/);
  await expect(page).toHaveURL(/[?&]view=search/);

  await forYou.click();
  await expect(forYou).toHaveAttribute("aria-current", "true");
  await expect(search).not.toHaveAttribute("aria-current", /.+/);
  await expect(page).not.toHaveURL(/[?&]view=search/);
});

test("header follow-alerts count chip sits fully inside the header bar", { tag: ["@J-NAV-31"] }, async ({ page }) => {
  await signInWithFollowAlerts(page);
  await page.goto("/jobs");
  const chip = page.getByTestId("topbar-follow-alerts-count");
  await expect(chip).toBeVisible({ timeout: 30_000 });
  const [header, box] = await Promise.all([page.locator('[data-region="header"]').boundingBox(), chip.boundingBox()]);
  expect(header).not.toBeNull();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(header!.x);
  expect(box!.y).toBeGreaterThanOrEqual(header!.y);
  expect(box!.x + box!.width).toBeLessThanOrEqual(header!.x + header!.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(header!.y + header!.height);
});

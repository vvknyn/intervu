import type { Page } from "@playwright/test";
import { MANAGE_FOLLOWS_HREF } from "../../../src/lib/follows/manage-path";
import { expect, test } from "./fixtures";

/**
 * Journeys for Settings › Account — see tests/journeys/CATALOG.md (J-SETTINGS-*).
 * Read-only: every server action a test depends on is answered in the browser.
 *
 * /settings itself is gated by the server session, which a spec can't mint.
 * `/mock/settings` renders the unmodified SettingsContainer behind the
 * dev-only `window.__INTERVU_E2E_AUTH__` user, so this spec runs against a
 * local dev server and skips itself against any other origin.
 */

const FOLLOWS = [
  { domain: "stripe.com", slug: "stripe-com", displayName: "Stripe", createdAt: "2026-09-02T00:00:00.000Z" },
  { domain: "acme.com", slug: "acme-com", displayName: "Acme", createdAt: "2026-09-01T00:00:00.000Z" },
];

/** Next server-action response in flight format: `1:` carries the action's return value. */
const flight = (value: unknown) => `0:{"a":"$@1","f":"","q":"","i":true,"b":"development"}\n1:D"$2"\n1:${JSON.stringify(value)}\n`;

type ActionAnswer = (body: string, text: string) => unknown | undefined | Promise<unknown | undefined>;

/** Answer server actions in the browser: `answer` returns a value to send
 *  back, or undefined to pass the real response through. */
async function answerActions(page: Page, answer: ActionAnswer) {
  await page.route(
    () => true,
    async (route) => {
      const req = route.request();
      if (req.method() !== "POST" || !req.headers()["next-action"]) return route.continue();
      const res = await route.fetch();
      const text = await res.text();
      const value = await answer(req.postData() ?? "", text);
      return route.fulfill({ response: res, body: value === undefined ? text : flight(value) });
    },
  );
}

test.afterEach(({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));

test.beforeEach(({ baseURL }) => {
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseURL ?? "http://localhost:3000");
  test.skip(!local, "signed-in settings need the dev-only __INTERVU_E2E_AUTH__ hook, which production builds ignore");
});

test("Account tab names the signed-in card \"Sign-in details\", not \"Sign in\"", { tag: ["@J-SETTINGS-04"] }, async ({ page }) => {
  await page.goto("/mock/settings?tab=account");
  await expect(page.getByRole("heading", { name: "Sign-in details" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toHaveCount(0);
});

test("Account tab lists followed companies A to Z, and Unfollow removes one", { tag: ["@J-SETTINGS-28"] }, async ({ page, diagnostics }) => {
  let unfollowed: string | null = null;
  await answerActions(page, (body, text) => {
    // listFollowsAction takes no arguments; unfollowCompanyAction takes the domain.
    if (body === "[]" && text.includes("User not authenticated")) {
      return { data: FOLLOWS.filter((f) => f.domain !== unfollowed) };
    }
    if (body === '["stripe.com"]') {
      unfollowed = "stripe.com";
      return {};
    }
    return undefined;
  });
  await page.goto("/mock/settings?tab=account");

  const section = page.getByTestId("followed-companies");
  await expect(section.getByRole("heading", { name: "Companies you follow" })).toBeVisible();
  const rows = section.getByTestId("followed-company-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Acme");
  await expect(rows.nth(1)).toContainText("Stripe");
  await expect(rows.nth(1).getByRole("link", { name: "Stripe" })).toHaveAttribute("href", "/co/stripe--com");

  await section.getByRole("button", { name: "Unfollow Stripe" }).click();
  await expect(page.getByText("Unfollowed Stripe")).toBeVisible();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Acme");
  expect(unfollowed).toBe("stripe.com");
  expect(diagnostics.pageErrors).toEqual([]);
});

test("Account tab says so when you follow no companies", { tag: ["@J-SETTINGS-29"] }, async ({ page }) => {
  await answerActions(page, (body, text) => (body === "[]" && text.includes("User not authenticated") ? { data: [] } : undefined));
  await page.goto("/mock/settings?tab=account");
  await expect(page.getByTestId("followed-companies-empty")).toContainText("You don't follow any companies yet.");
});

test("A failed email-preferences read ends in an error with Try again, and Try again reads it again", { tag: ["@J-SETTINGS-30"] }, async ({ page }) => {
  let failReads = true;
  await answerActions(page, (_body, text) => {
    if (!text.includes("Sign in to manage email preferences.")) return undefined;
    return failReads ? { error: "Firestore unavailable" } : { data: { digestEnabled: true, needsEmail: false, blockedGlobally: false } };
  });
  await page.goto("/mock/settings?tab=account");

  await expect(page.getByText("Couldn't load your email preferences.")).toBeVisible();
  await expect(page.getByText("Loading email preferences")).toHaveCount(0);
  failReads = false;
  await page.getByTestId("email-preferences-retry").click();
  await expect(page.getByRole("switch", { name: "Weekly digest" })).toBeVisible();
});

test("Daily picks are off until you turn them on, and turning them on says when none can go out yet", { tag: ["@J-SETTINGS-34"] }, async ({ page, diagnostics }) => {
  let on = false;
  const writes: string[] = [];
  await answerActions(page, (body, text) => {
    if (text.includes("Sign in to manage email preferences.")) return { data: { digestEnabled: true, needsEmail: false, blockedGlobally: false } };
    if (!text.includes("Sign in to get daily picks.")) return undefined;
    // getDailyPicksAction takes no arguments; setDailyPicksAction takes on/off.
    if (body === "[]") return { data: { on, reachable: true, blockedGlobally: false, emailedIds: [], resumeReady: on ? false : null } };
    writes.push(body);
    on = body === "[true]";
    return { success: true };
  });
  await page.goto("/mock/settings?tab=account");

  const row = page.getByTestId("daily-picks-setting");
  const toggle = row.getByRole("switch", { name: "Daily picks" });
  await expect(toggle).toHaveAttribute("aria-checked", "false", { timeout: 30_000 });
  await expect(row).toContainText("Up to 5 new roles a day that fit your résumé and level, each with why.");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => writes).toEqual(["[true]"]);
  // The saved résumé here can't be ranked: it says no email can go out yet, and where to fix that.
  const notReady = row.getByTestId("daily-picks-resume-not-ready");
  await expect(notReady).toContainText("None can go out yet");
  await expect(notReady.getByRole("link", { name: "Upload it on Jobs" })).toHaveAttribute("href", "/jobs");
  expect(diagnostics.pageErrors).toEqual([]);
});

test("The account menu's new-roles row opens the list, whose link goes to the companies you follow, not the Elite board", { tag: ["@J-NAV-40"] }, async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__INTERVU_E2E_AUTH__ = { uid: "u1", displayName: "Ada Lovelace", email: "ada@example.com" };
    localStorage.setItem("intervu.onboarding.completed", "1");
  });
  await answerActions(page, (body, text) => {
    if (body === "[]" && text.includes("User not authenticated")) return { data: [FOLLOWS[1]] };
    if (body.startsWith('["') && body.includes("acme.com")) {
      return { data: [{ domain: "acme.com", displayName: "Acme", jobs: [{ id: "j1", title: "Role 1", posted_ts: Date.now() }] }] };
    }
    return undefined;
  });
  await page.goto("/jobs");
  await page.getByTestId("topbar-avatar").click();
  await page.getByTestId("account-menu-follow-alerts").click();
  await expect(page.getByTestId("follow-alert-row")).toHaveCount(1);
  const cta = page.getByTestId("follow-alerts-cta");
  await expect(cta).toHaveText("Manage companies you follow");
  await expect(cta).toHaveAttribute("href", MANAGE_FOLLOWS_HREF);
});

test("A failed read of the saved preferences shows Retry on the languages row, not the résumé's language", { tag: ["@J-SETTINGS-35"] }, async ({ page }) => {
  const saved = { configured: true, search: { languages: ["german"] }, answers: { custom: {} } };
  let failReads = true;
  let reads = 0;
  await answerActions(page, async (body, text) => {
    // fetchAgentPreferencesAction takes no arguments. The form reads it first (twice, dev StrictMode); every read after that is the languages row's.
    if (body !== "[]" || !text.includes("Unauthorized")) return undefined;
    return failReads && ++reads > 2 ? { error: "Preferences unavailable" } : { data: saved };
  });
  await page.goto("/mock/settings?tab=prefs");

  await expect(page.getByTestId("settings-languages-load-failed")).toBeVisible();
  await expect(page.getByTestId("settings-languages-row")).toHaveCount(0);
  failReads = false;
  await page.getByTestId("settings-languages-load-failed-retry").click();
  await expect(page.getByTestId("settings-languages-row")).toBeVisible();
  await expect(page.getByTestId("settings-languages")).toContainText(/german/i);
});

test("While the saved preferences are still being read, the languages row shows no value and sends no save; when the read answers it shows the stored language", { tag: ["@J-SETTINGS-36"] }, async ({ page }) => {
  const saved = { configured: true, search: { languages: ["german"] }, answers: { custom: {} } };
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  let reads = 0;
  const saves: string[] = [];
  await answerActions(page, async (body, text) => {
    if (body.includes("languages")) saves.push(body);
    if (body !== "[]" || !text.includes("Unauthorized")) return undefined;
    // The form reads first (twice, dev StrictMode); every read after that is the languages row's, and it hangs until released.
    if (++reads > 2) await held;
    return { data: saved };
  });
  await page.goto("/mock/settings?tab=prefs");

  await expect(page.getByText("Loading your language")).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(page.getByTestId("settings-languages-row")).toHaveCount(0);
  await expect(page.getByTestId("settings-languages")).toHaveCount(0);
  expect(saves).toEqual([]);

  release();
  await expect(page.getByTestId("settings-languages-row")).toBeVisible();
  await expect(page.getByTestId("settings-languages")).toContainText(/german/i);
  expect(saves).toEqual([]);
});

import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { actionObject, PRODUCTION_SIGN_IN_ACCOUNT, signInLikeProduction, withActionResult } from "./signed-in";
import { LOCAL_AI_RESUME_KEY } from "../../../src/lib/local-ai/resume-storage";

/**
 * A new account's setup (components/onboarding/): the welcome strip beside
 * the page it signed in on, the three-step sheet, setup as /jobs itself, and
 * the account menu's "Finish setup". Signed in the way production is, with
 * the account's setup, its Settings › Preferences writes and its saved
 * searches answered here, so nothing is written anywhere.
 */

const UID = PRODUCTION_SIGN_IN_ACCOUNT.uid;
const COMPANY = "/co/shopify--com";

type SetupRecord = { state: "open" | "finished"; started_at: string; steps: { [step: string]: "done" | "skipped" }; strip_days: string[]; hidden_day: string | null };
type Facts = { resumeOnFile: boolean; roles: string | null; location: string | null; remoteOnly: boolean; savedSearches: number };
type View = {
  record: SetupRecord;
  facts: Facts;
  resumeTitle: string | null;
  resumeLocation: string | null;
  resumeUpdatedAt: string | null;
  relocation: string | null;
  connectionCountry: string | null;
};

/** A setup made at sign-up a minute ago, nothing answered yet. */
function freshView(over: { record?: Partial<SetupRecord>; facts?: Partial<Facts>; connectionCountry?: string | null } = {}): View {
  return {
    record: { state: "open", started_at: new Date(Date.now() - 60_000).toISOString(), steps: {}, strip_days: [], hidden_day: null, ...over.record },
    facts: { resumeOnFile: false, roles: null, location: null, remoteOnly: false, savedSearches: 0, ...over.facts },
    resumeTitle: null,
    resumeLocation: null,
    resumeUpdatedAt: null,
    relocation: null,
    connectionCountry: over.connectionCountry === undefined ? "Canada" : over.connectionCountry,
  };
}

interface Account {
  /** Each setup write (`updateOnboardingAction`), in order. */
  setupWrites: { [key: string]: unknown }[];
  /** Each Settings › Preferences write (`saveAgentPreferencesAction`). */
  preferenceWrites: { [key: string]: unknown }[];
  /** Each saved search (`saveSavedSearchAction`). */
  savedSearches: { [key: string]: unknown }[];
}

/**
 * Signs in as a new account whose setup is `view` (null: an account made
 * before setup existed). Setup's own actions name the account, so they are
 * told apart from the page's other actions by that first argument.
 */
async function signInNewAccount(page: Page, view: View | null): Promise<Account> {
  const account: Account = { setupWrites: [], preferenceWrites: [], savedSearches: [] };
  await signInLikeProduction(page, (args) => {
    if (args.length === 1 && args[0] === UID) return { data: view };
    if (args.length === 2 && args[0] === UID) {
      account.setupWrites.push(actionObject(args[1]));
      return { data: view?.record ?? null };
    }
    if (args.length === 0) return { data: [] };
    const input = actionObject(args[0]);
    if (args.length === 1 && typeof input.name === "string" && typeof input.href === "string") {
      account.savedSearches.push(input);
      return { data: { id: "saved-onboarding", name: input.name, href: input.href } };
    }
    return undefined;
  });
  // Settings › Preferences refuses a browser with no session as "Unauthorized",
  // which the sign-in above leaves alone. Registered after it, so it sees each
  // request first.
  await page.route(
    () => true,
    async (route) => {
      const req = route.request();
      if (req.method() !== "POST" || !req.headers()["next-action"]) return route.fallback();
      let args: unknown;
      try {
        args = JSON.parse(req.postData() ?? "");
      } catch {
        return route.fallback();
      }
      const patch = Array.isArray(args) && args.length === 1 ? actionObject(args[0]) : null;
      if (!patch || !(patch.search || patch.answers) || "name" in patch) return route.fallback();
      const res = await route.fetch();
      const text = await res.text();
      if (!text.includes("Unauthorized")) return route.fulfill({ response: res, body: text });
      account.preferenceWrites.push(patch);
      const search = actionObject(patch.search);
      const answers = actionObject(patch.answers);
      const saved = { configured: true, search, answers: { custom: {}, ...answers } };
      return route.fulfill({ response: res, body: withActionResult(text, { data: saved }) });
    },
  );
  return account;
}

async function signedIn(page: Page) {
  await expect(page.getByTestId("topbar-avatar")).toBeVisible({ timeout: 30_000 });
}

async function openAccountMenu(page: Page) {
  await page.getByTestId("topbar-avatar").click();
  await expect(page.getByRole("menu")).toBeVisible();
}

const marker = (scope: Locator, step: string) => scope.locator(`[data-testid="setup-step-marker"][data-step="${step}"]`);
const writesWith = (account: Account, key: string) => account.setupWrites.filter((w) => key in w);

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("a new account on the company page it signed in on gets that page, a one-line welcome strip and no dialog; Set up opens the steps over the page", { tag: ["@J-ONBOARD-01"] }, async ({ page, diagnostics }) => {
  const account = await signInNewAccount(page, freshView());
  await page.goto(COMPANY);
  await signedIn(page);

  const strip = page.getByTestId("welcome-strip");
  await expect(strip).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`${COMPANY}$`));
  // Today counts as the first of the strip's visit days.
  await expect.poll(() => writesWith(account, "stripDay").length).toBe(1);

  await page.getByTestId("welcome-strip-setup").click();
  const sheet = page.getByTestId("setup-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "What kind of role are you after?" })).toBeVisible();
  await expect(sheet.getByTestId("setup-step-marker")).toHaveCount(3);
  await expect(marker(sheet, "resume")).toHaveAttribute("aria-current", "step");
  expect(diagnostics.pageErrors).toEqual([]);
});

test("a new account that landed on bare /jobs gets setup as the page itself, with no strip on top", { tag: ["@J-ONBOARD-02"] }, async ({ page, diagnostics }) => {
  await signInNewAccount(page, freshView());
  await page.goto("/jobs");
  await signedIn(page);

  const panel = page.getByTestId("setup-panel");
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByRole("heading", { name: "Set up your search" })).toBeVisible();
  await expect(page.getByTestId("welcome-strip")).toHaveCount(0);
  // "Add your résumé" opens the importer right here, not on another page.
  await panel.getByTestId("setup-add-resume").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page).toHaveURL(/\/jobs(\?|$)/);
  expect(diagnostics.pageErrors).toEqual([]);
});

test("every step skips: setup says it's done, goes away for good, and the account menu stops offering it", { tag: ["@J-ONBOARD-03"] }, async ({ page, diagnostics }) => {
  const account = await signInNewAccount(page, freshView());
  await page.goto("/jobs");
  await signedIn(page);

  const panel = page.getByTestId("setup-panel");
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await panel.getByTestId("setup-skip").click();
  await expect(panel.getByRole("heading", { name: "Where can you work?" })).toBeVisible();
  await expect(marker(panel, "resume")).toHaveAttribute("data-outcome", "skipped");
  await panel.getByTestId("setup-skip").click();
  await expect(panel.getByRole("heading", { name: "Get new roles by email?" })).toBeVisible();
  await panel.getByTestId("setup-skip").click();

  await expect(page.getByText("Setup done. Change any of it in Settings › Preferences.")).toBeVisible();
  await expect(page.getByTestId("setup-panel")).toHaveCount(0);
  await expect(page.getByTestId("welcome-strip")).toHaveCount(0);
  await expect
    .poll(() => account.setupWrites.filter((w) => "step" in w).map((w) => actionObject(w.step)))
    .toEqual([
      { step: "resume", outcome: "skipped" },
      { step: "place", outcome: "skipped" },
      { step: "email", outcome: "skipped" },
    ]);
  expect(writesWith(account, "finish")).toHaveLength(1);
  expect(account.preferenceWrites).toEqual([]);
  expect(account.savedSearches).toEqual([]);

  await openAccountMenu(page);
  await expect(page.getByTestId("account-menu-finish-setup")).toHaveCount(0);
  expect(diagnostics.pageErrors).toEqual([]);
});

test("Later hides the strip for the day and the account menu still offers Finish setup; after three visit days only the menu does", { tag: ["@J-ONBOARD-04"] }, async ({ page, diagnostics }) => {
  const account = await signInNewAccount(page, freshView());
  await page.goto(COMPANY);
  await signedIn(page);

  await expect(page.getByTestId("welcome-strip")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("welcome-strip-later").click();
  await expect(page.getByTestId("welcome-strip")).toHaveCount(0);
  await expect.poll(() => writesWith(account, "laterDay").length).toBe(1);

  await openAccountMenu(page);
  const finish = page.getByTestId("account-menu-finish-setup");
  await expect(finish).toHaveText("Finish setup (3 steps left)");
  await finish.click();
  await expect(page.getByTestId("setup-sheet")).toBeVisible();
  expect(diagnostics.pageErrors).toEqual([]);
});

test("a setup whose strip already showed on three earlier days shows no strip, only the account menu's Finish setup", { tag: ["@J-ONBOARD-04"] }, async ({ page, diagnostics }) => {
  const account = await signInNewAccount(
    page,
    freshView({ record: { strip_days: ["2026-01-05", "2026-01-06", "2026-01-08"], steps: { resume: "skipped" } } }),
  );
  await page.goto(COMPANY);
  await signedIn(page);

  await openAccountMenu(page);
  await expect(page.getByTestId("account-menu-finish-setup")).toHaveText("Finish setup (2 steps left)");
  await expect(page.getByTestId("welcome-strip")).toHaveCount(0);
  expect(writesWith(account, "stripDay")).toEqual([]);
  expect(diagnostics.pageErrors).toEqual([]);
});

test("a résumé already in this browser answers step 1 and fills step 2's place, saying it came from the résumé", { tag: ["@J-ONBOARD-05"] }, async ({ page, diagnostics }) => {
  await page.addInitScript(
    ([key, resume]) => localStorage.setItem(key as string, JSON.stringify({ data: resume, updatedAt: new Date().toISOString(), sourceLabel: "e2e-synthetic" })),
    [
      LOCAL_AI_RESUME_KEY,
      {
        profile: { name: "Priya Raman", profession: "Primary School Teacher", yearsOfExperience: 6, location: "Manchester, UK", email: "", phone: "" },
        experience: [{ id: "exp1", company: "Oakfield Primary", role: "Year 4 Teacher", dates: "2019 - Present", description: "Planned and taught the Year 4 curriculum." }],
        competencies: [],
        education: [],
        generatedSummary: "Primary school teacher with six years in Key Stage 2.",
      },
    ] as const,
  );
  await signInNewAccount(page, freshView());
  await page.goto(COMPANY);
  await signedIn(page);

  await page.getByTestId("welcome-strip-setup").click({ timeout: 15_000 });
  const sheet = page.getByTestId("setup-sheet");
  await expect(marker(sheet, "resume")).toHaveAttribute("data-outcome", "done");
  await expect(marker(sheet, "place")).toHaveAttribute("aria-current", "step");
  await expect(sheet.getByTestId("setup-place")).toHaveValue("Manchester, UK");
  await expect(sheet.getByTestId("setup-place-source")).toHaveText("From your résumé.");
  expect(diagnostics.pageErrors).toEqual([]);
});

test("step 2 says where its place came from and saves the answer to Settings › Preferences", { tag: ["@J-ONBOARD-06"] }, async ({ page, diagnostics }) => {
  const account = await signInNewAccount(page, freshView({ connectionCountry: "Canada" }));
  await page.goto(COMPANY);
  await signedIn(page);

  await page.getByTestId("welcome-strip-setup").click({ timeout: 15_000 });
  const sheet = page.getByTestId("setup-sheet");
  await sheet.getByTestId("setup-skip").click();
  await expect(sheet.getByTestId("setup-place")).toHaveValue("Canada");
  await expect(sheet.getByTestId("setup-place-source")).toHaveText(
    "Based on your internet connection today. Change it if you work somewhere else.",
  );

  await sheet.getByTestId("setup-place").fill("Bengaluru, Karnataka");
  await expect(sheet.getByTestId("setup-place-source")).toHaveCount(0);
  await sheet.getByTestId("setup-relocation-to").click();
  // Asked where, it says so beside the button rather than saving half an answer.
  await sheet.getByTestId("setup-place-save").click();
  await expect(sheet.getByRole("alert")).toHaveText("Say where you'd move to, or pick another answer.");
  expect(account.preferenceWrites).toEqual([]);

  await sheet.getByTestId("setup-relocation-places").fill("Singapore");
  await sheet.getByTestId("setup-place-save").click();
  await expect(sheet.getByRole("heading", { name: "Get new roles by email?" })).toBeVisible();
  expect(account.preferenceWrites).toEqual([
    { search: { location: "Bengaluru, Karnataka", remoteOnly: false }, answers: { relocation: "Open to relocating to Singapore" } },
  ]);
  await expect
    .poll(() => account.setupWrites.filter((w) => "step" in w).map((w) => actionObject(w.step)))
    .toEqual([
      { step: "resume", outcome: "skipped" },
      { step: "place", outcome: "done" },
    ]);
  expect(diagnostics.pageErrors).toEqual([]);
});

test("step 3 shows the weekly search it would save, and saves it only on the tap", { tag: ["@J-ONBOARD-07"] }, async ({ page, diagnostics }) => {
  const account = await signInNewAccount(page, freshView({ facts: { roles: "Registered nurse", location: "Toronto, ON" } }));
  await page.goto(COMPANY);
  await signedIn(page);

  // The account already holds roles and a place, so setup opens on step 3.
  await page.getByTestId("welcome-strip-setup").click({ timeout: 15_000 });
  const sheet = page.getByTestId("setup-sheet");
  await expect(sheet.getByRole("heading", { name: "Get new roles by email?" })).toBeVisible();
  await expect(sheet.getByTestId("setup-email-search")).toHaveText("Registered nurse in Toronto, ON");
  // Every number says what it counts.
  await expect(sheet.getByTestId("setup-email-count")).toHaveText(/posted in the last 7 days|None posted in the last 7 days/, { timeout: 15_000 });
  await expect(sheet.getByText(/once a week/)).toBeVisible();
  expect(account.savedSearches).toEqual([]);

  await sheet.getByTestId("setup-email-yes").click();
  await expect(page.getByText("Setup done. Change any of it in Settings › Preferences.")).toBeVisible();
  expect(account.savedSearches).toHaveLength(1);
  const href = String(account.savedSearches[0].href);
  expect(href).toContain("q=Registered+nurse");
  expect(href).toContain("Toronto");
  await expect(page.getByTestId("setup-sheet")).toHaveCount(0);
  await expect.poll(() => writesWith(account, "finish").length).toBe(1);
  expect(diagnostics.pageErrors).toEqual([]);
});

test("on a phone the strip is one line and a swipe down closes the sheet as Later", { tag: ["@J-ONBOARD-08"] }, async ({ page, diagnostics }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "a phone width");
  const account = await signInNewAccount(page, freshView());
  await page.goto(COMPANY);
  await signedIn(page);

  const strip = page.getByTestId("welcome-strip");
  await expect(strip).toBeVisible({ timeout: 15_000 });
  const line = await strip.locator("p").boundingBox();
  const lineHeight = await strip.locator("p").evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
  expect(Math.round(line!.height)).toBeLessThanOrEqual(Math.ceil(lineHeight));

  await page.getByTestId("welcome-strip-setup").click();
  const sheet = page.getByTestId("setup-sheet");
  await expect(sheet).toBeVisible();
  await expect.poll(() => sheet.evaluate((el) => el.getAnimations().length), { timeout: 10_000 }).toBe(0);
  const open = (await sheet.boundingBox())!;
  await fingerDrag(page, open.x + open.width / 2, open.y + 10, 240);
  await expect(sheet).toBeHidden();
  await expect.poll(() => writesWith(account, "laterDay").length).toBe(1);
  await expect(strip).toHaveCount(0);
  expect(diagnostics.pageErrors).toEqual([]);
});

test("an account made before setup existed sees no strip, no setup on /jobs and no Finish setup", { tag: ["@J-ONBOARD-09"] }, async ({ page, diagnostics }) => {
  const account = await signInNewAccount(page, null);
  await page.goto(COMPANY);
  await signedIn(page);
  await openAccountMenu(page);
  await expect(page.getByRole("menuitem").first()).toBeVisible();
  await expect(page.getByTestId("account-menu-finish-setup")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("welcome-strip")).toHaveCount(0);

  await page.goto("/jobs");
  await signedIn(page);
  await expect(page.getByTestId("search-submit").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("setup-panel")).toHaveCount(0);
  await expect(page.getByTestId("welcome-strip")).toHaveCount(0);
  expect(account.setupWrites).toEqual([]);
  expect(diagnostics.pageErrors).toEqual([]);
});

test("the welcome email's Finish setup link opens the steps over /jobs and leaves a plain /jobs address", { tag: ["@J-ONBOARD-10"] }, async ({ page, diagnostics }) => {
  await signInNewAccount(page, freshView());
  await page.goto("/jobs?setup=open");
  await signedIn(page);

  const sheet = page.getByTestId("setup-sheet");
  await expect(sheet).toBeVisible({ timeout: 15_000 });
  await expect(sheet.getByRole("heading", { name: "What kind of role are you after?" })).toBeVisible();
  await expect(page).not.toHaveURL(/setup=open/);
  // The sheet is the setup on screen; the panel steps aside under it.
  await expect(page.getByTestId("setup-panel")).toHaveCount(0);
  expect(diagnostics.pageErrors).toEqual([]);
});

test("signed out, the welcome email's Finish setup link is plain /jobs", { tag: ["@J-ONBOARD-10"] }, async ({ page, diagnostics }) => {
  await page.goto("/jobs?setup=open");
  await expect(page.getByTestId("topbar-signin").first()).toBeVisible({ timeout: 30_000 });
  await expect(page).not.toHaveURL(/setup=open/);
  await expect(page.getByTestId("setup-sheet")).toHaveCount(0);
  await expect(page.getByTestId("welcome-strip")).toHaveCount(0);
  expect(diagnostics.pageErrors).toEqual([]);
});

/** A finger on the phone's screen: down at (x, y), `dy` px straight down in eight moves, then up (as phone.spec.ts). */
async function fingerDrag(page: Page, x: number, y: number, dy: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let i = 1; i <= 8; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + (dy * i) / 8 }] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

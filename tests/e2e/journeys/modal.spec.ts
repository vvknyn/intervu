import type { Locator, Page } from "@playwright/test";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { LOCAL_AI_ENABLED_KEY } from "../../../src/lib/local-ai/flag";
import { LOCAL_AI_RESUME_KEY } from "../../../src/lib/local-ai/resume-storage";
import { descriptionToBullets } from "../../../src/lib/resume/merge-bullet-lines";
import { expect, test } from "./fixtures";

/**
 * Journeys for the shared overlay primitive (ui/dialog + ui/sheet) — see tests/journeys/CATALOG.md (J-MODAL-*).
 * Read-only: the résumé is parsed (or tailored) in the browser and never leaves it.
 */

const VIEWPORTS = [
  { name: "1280x600", width: 1280, height: 600 },
  { name: "390x844", width: 390, height: 844 },
  // A phone with the software keyboard open leaves about this much layout viewport.
  { name: "390x420", width: 390, height: 420 },
];

const COMPANIES = ["Acme Robotics", "Northwind Labs", "Globex Systems", "Initech Cloud", "Umbrella Data", "Hooli Search", "Stark Analytics"];

/** A plain-text résumé with 7 dated roles: enough that the review step overflows a 600px-tall viewport. */
const RESUME_TEXT = [
  "Jordan Rivera",
  "Senior Software Engineer",
  "jordan.rivera@example.com | Toronto, ON",
  "",
  "EXPERIENCE",
  ...COMPANIES.flatMap((company, i) => [
    `Software Engineer, ${company}`,
    `${2024 - i * 2} - ${2026 - i * 2}`,
    `- Built and shipped services used by ${i + 2} product teams.`,
    `- Reduced p95 latency by ${10 + i}% across the platform.`,
    "",
  ]),
  "EDUCATION",
  "B.Sc. Computer Science, University of Waterloo, 2012",
  "",
  "SKILLS",
  "TypeScript, React, Node.js, PostgreSQL, Kubernetes",
].join("\n");

const dialogBody = (dialog: Locator) => dialog.locator('[data-slot="dialog-body"]');

/** Box of the element sits fully inside the viewport (no pixel of it unreachable). */
async function expectInViewport(page: Page, el: Locator) {
  const box = await el.boundingBox();
  const vh = page.viewportSize()!.height;
  expect(box, "element has a box").not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(vh + 1);
}

/**
 * Scroll like a user (wheel over the dialog), never `scrollIntoView`: that also moves `overflow:hidden`
 * boxes, which is exactly how a clipped modal passes a programmatic check. The target must end fully
 * visible, above the pinned footer (if any), inside the viewport.
 */
async function wheelRevealsAboveFooter(page: Page, dialog: Locator, target: Locator, footer: Locator | null) {
  const vh = page.viewportSize()!.height;
  // Wheel events aimed at a still-animating dialog land on stale coordinates.
  await dialog.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
  const dialogBox = (await dialog.boundingBox())!;
  await page.mouse.move(dialogBox.x + dialogBox.width / 2, dialogBox.y + dialogBox.height / 2);
  const revealed = async () => {
    const [box, footerBox] = await Promise.all([target.boundingBox(), footer?.boundingBox()]);
    return !!box && box.y >= 0 && box.y + box.height <= Math.min(footerBox?.y ?? vh, vh) + 1;
  };
  for (let i = 0; i < 60 && !(await revealed()); i++) {
    await page.mouse.wheel(0, 250);
    await page.waitForTimeout(40);
  }
  expect(await revealed(), "target reachable by wheel-scrolling, above the footer, inside the viewport").toBe(true);
}

for (const vp of VIEWPORTS) {
  test(`résumé import modal scrolls to the last experience entry at ${vp.name}`, { tag: ["@J-MODAL-01"] }, async ({ page, diagnostics }) => {
    await page.setViewportSize(vp);
    await page.goto("/resume");
    await page.getByTestId("resume-signed-out-upload").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Input step: the dialog fits the viewport and its footer buttons are reachable.
    await expectInViewport(page, dialog);
    await expect(dialog.getByTestId("resume-import-parse-primary")).toBeInViewport();

    await dialog.locator('input[type="file"]').setInputFiles({ name: "resume.txt", mimeType: "text/plain", buffer: Buffer.from(RESUME_TEXT) });
    await dialog.getByTestId("resume-import-parse-primary").click();

    // Located by the parsed values, not by review-step markup (which another change owns).
    const back = dialog.getByRole("button", { name: "Back" }); // the review step's footer
    await expect(back).toBeVisible({ timeout: 30_000 });
    const fields = dialog.locator("input, textarea");
    const companyFieldIndexes = await fields.evaluateAll((els, companies) => {
      const firstIndexPerCompany = companies.map((c) => els.findIndex((el) => (el as HTMLInputElement).value.includes(c)));
      return firstIndexPerCompany.filter((i) => i >= 0);
    }, COMPANIES);
    expect(companyFieldIndexes.length, "fixture yields at least 6 experience entries").toBeGreaterThanOrEqual(6);
    const lastEntry = fields.nth(Math.max(...companyFieldIndexes));

    const confirm = dialog.locator('[data-slot="dialog-footer"]').getByRole("button").last();
    const pageScrollBefore = await page.evaluate(() => window.scrollY);
    await wheelRevealsAboveFooter(page, dialog, lastEntry, back);
    const body = dialogBody(dialog);
    const overflow = await body.evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(overflow, "body overflows, so this run really exercises scrolling").toBeGreaterThan(0);
    // ...and the last field of the body (below Experience) is reachable too.
    await wheelRevealsAboveFooter(page, dialog, body.locator("input, textarea").last(), back);
    await expectInViewport(page, dialog);
    await expect(back).toBeInViewport();
    await expect(confirm).toBeInViewport();

    // The page behind does not scroll while the modal body does.
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe("hidden");
    expect(await page.evaluate(() => window.scrollY), "no scroll bleed to the page").toBe(pageScrollBefore);

    // Clickable, not just visible: Back returns to the input step.
    await back.click();
    await expect(dialog.getByTestId("resume-import-parse-primary")).toBeVisible();
    expect(diagnostics.pageErrors).toEqual([]);
  });
}

for (const vp of VIEWPORTS) {
  test(`sign-in dialog fits ${vp.name} and its last control is reachable by scrolling`, { tag: ["@J-MODAL-02"] }, async ({ page, diagnostics }) => {
    await page.setViewportSize(vp);
    await page.goto("/resume");
    await page.getByTestId("topbar-signin").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expectInViewport(page, dialog);

    await wheelRevealsAboveFooter(page, dialog, dialog.getByRole("button", { name: "Forgot password?" }), null);
    await expectInViewport(page, dialog);
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe("hidden");

    // Clickable, and the close control still dismisses it.
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();
    expect(diagnostics.pageErrors).toEqual([]);
  });
}

/** A guest résumé kept in this browser: enough for /jobs to offer "Customize résumé" on a role. */
const GUEST_RESUME = {
  profile: {
    name: "Sam Rivera",
    profession: "Senior Software Engineer",
    yearsOfExperience: 7,
    location: "San Francisco, CA",
    email: "sam.rivera.dev@example.com",
    phone: "",
  },
  experience: [
    {
      id: "exp1",
      company: "Nimbus Data",
      role: "Senior Software Engineer",
      dates: "2021 - Present",
      description: "Built and scaled backend services in TypeScript/Node and Go on AWS. Mentored 3 junior engineers.",
    },
  ],
  competencies: [{ category: "Languages", skills: ["TypeScript", "Go", "Python", "SQL"] }],
  education: [],
  generatedSummary: "Senior software engineer with 7 years of experience building backend systems.",
};

/** Wait out the open animation. A cancelled animation (the overlay re-renders as it opens) rejects `finished`; that one is done too. */
async function settled(el: Locator) {
  await el.evaluate((node) => Promise.all(node.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => undefined))));
}

/** The dialog is the topmost layer where `el` is drawn: its centre hits `el`, not a scrim stacked above. */
async function isTopmost(el: Locator) {
  return el.evaluate((node) => {
    const r = node.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return !!hit && node.contains(hit);
  });
}

test("Customize résumé dialog sits above its dim layer: its buttons take clicks and Close dismisses it", { tag: ["@J-MODAL-03"] }, async ({ page, diagnostics }) => {
  await page.addInitScript(
    ([onboardingKey, resumeKey, resume]) => {
      localStorage.setItem(onboardingKey as string, "1");
      localStorage.setItem(resumeKey as string, JSON.stringify({ data: resume, updatedAt: new Date().toISOString(), sourceLabel: "e2e-synthetic" }));
    },
    [ONBOARDING_COMPLETED_STORAGE_KEY, LOCAL_AI_RESUME_KEY, GUEST_RESUME] as const,
  );
  await page.goto("/jobs?view=search&q=engineer");
  // The row centre is the company link; the title is the detail affordance.
  await page.getByTestId("job-row").getByTestId("job-title").first().click({ timeout: 45_000 });
  await page.locator('[data-testid="local-customize-open"]:visible').first().click({ timeout: 15_000 });

  // By name: on a phone the role itself is open in a sheet, which is a dialog too and stays open.
  const dialog = page.getByRole("dialog", { name: "Your résumé is ready. Customize for this role." });
  await expect(dialog.getByRole("heading", { name: "Your résumé is ready. Customize for this role." })).toBeVisible();
  await settled(dialog);
  // A dialog stacked under its own scrim renders dimmed and swallows every click (2026-09-30).
  const close = dialog.getByTestId("local-customize-close");
  expect(await isTopmost(close), "Close is the topmost element, not under the dialog's scrim").toBe(true);

  // A rules draft is tailored on this device (no model download): the dialog's own buttons work.
  await dialog.getByRole("button", { name: "Use a rules draft" }).click();
  await expect(dialog.getByTestId("local-customize-copy")).toBeVisible({ timeout: 30_000 });
  await close.click();
  await expect(dialog).toBeHidden();
  expect(diagnostics.pageErrors).toEqual([]);
});

test("Track a role: the Status picker opens above the sheet and picking an option sets it", { tag: ["@J-MODAL-04"] }, async ({ page, diagnostics }) => {
  await page.goto("/yours?view=new");
  const sheet = page.getByRole("dialog", { name: "Track a role" });
  await expect(sheet).toBeVisible({ timeout: 30_000 });
  await settled(sheet);

  const status = sheet.getByRole("combobox");
  await status.click();
  // Portaled to <body>: a menu stacked under the sheet opens invisibly behind it (2026-09-30).
  const option = page.getByRole("option", { name: "Interviewing" });
  await expect(option).toBeVisible();
  expect(await isTopmost(option), "the option is the topmost element, not under the sheet").toBe(true);
  await option.click();
  await expect(status).toHaveText("Interviewing");

  // Close without saving: nothing is tracked.
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden();
  expect(diagnostics.pageErrors).toEqual([]);
});

test("account menu Feedback: the menu closes, the dialog and its Type picker take clicks, Cancel closes it", { tag: ["@J-MODAL-05"] }, async ({ page, baseURL }) => {
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseURL ?? "http://localhost:3000");
  test.skip(!local, "the account menu needs the dev-only __INTERVU_E2E_AUTH__ sign-in, which production builds ignore");
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__INTERVU_E2E_AUTH__ = {
      uid: "u1", displayName: "Ada Lovelace", email: "ada@example.com", emailVerified: true, isAnonymous: false,
      providerData: [], metadata: {}, photoURL: null, phoneNumber: null, providerId: "password", tenantId: null, refreshToken: "x",
    };
  });
  await page.goto("/resume");
  // The fake sign-in re-renders the header after hydration, which can drop a click or close the menu.
  const feedback = page.getByRole("menuitem", { name: "Feedback" });
  const dialog = page.getByRole("dialog", { name: "Send Feedback" });
  await expect(async () => {
    if (await dialog.isVisible()) return;
    if (!(await feedback.isVisible())) await page.getByTestId("topbar-avatar").click({ timeout: 2_000 });
    await feedback.click({ timeout: 2_000 });
    await expect(dialog).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  // Menus sit a layer above dialogs; one left open would paint over this one.
  // (Not by role: the open dialog aria-hides everything else, a menu left open included.)
  await expect(page.locator('[data-slot="dropdown-menu-content"]')).toHaveCount(0);
  await settled(dialog);

  await dialog.getByRole("combobox").click();
  const bug = page.getByRole("option", { name: "Report a Bug" });
  await expect(bug).toBeVisible();
  expect(await isTopmost(bug), "the option is the topmost element, not under the dialog").toBe(true);
  await bug.click();
  await expect(dialog.getByRole("combobox")).toHaveText("Report a Bug");

  // Nothing is sent: Cancel closes, and the page takes clicks again.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await page.getByTestId("topbar-avatar").click();
  await expect(feedback).toBeVisible();
  // No pageErrors check: the fake sign-in lands before hydration, so the header always logs a hydration mismatch.
});

// A draft is tailored to one role. Accept used to write it over the résumé every other role ranks and
// tailors from, so one Customize cost a guest their own résumé (2026-09-30).
test("Customize résumé leaves the guest's résumé as it was: the draft is copied or downloaded, never saved over it", { tag: ["@J-MODAL-06"] }, async ({ page, diagnostics }) => {
  await page.addInitScript(
    ([onboardingKey, enabledKey, resumeKey, resume]) => {
      localStorage.setItem(onboardingKey as string, "1");
      // On-device mode on: the old Accept also wrote the draft into this browser's stored résumé.
      localStorage.setItem(enabledKey as string, "1");
      localStorage.setItem(resumeKey as string, JSON.stringify({ data: resume, updatedAt: new Date().toISOString(), sourceLabel: "e2e-synthetic" }));
    },
    [ONBOARDING_COMPLETED_STORAGE_KEY, LOCAL_AI_ENABLED_KEY, LOCAL_AI_RESUME_KEY, GUEST_RESUME] as const,
  );
  await page.goto("/jobs?view=search&q=engineer");
  await page.getByTestId("job-row").getByTestId("job-title").first().click({ timeout: 45_000 });
  const open = page.locator('[data-testid="local-customize-open"]:visible').first();
  // By name: on a phone the job sheet is a dialog too.
  const dialog = page.getByRole("dialog", { name: "Your résumé is ready. Customize for this role." });

  for (const pass of ["first", "second"]) {
    await open.click({ timeout: 15_000 });
    await settled(dialog);
    await dialog.getByRole("button", { name: "Use a rules draft" }).click();
    await expect(dialog.getByTestId("local-customize-copy")).toBeVisible({ timeout: 30_000 });
    // The draft starts from the guest's own résumé every time, not from an earlier role's draft:
    // every change it lists was made to the guest's own summary or lines.
    await expect(dialog.getByTestId("tailor-changes-count").or(dialog.getByTestId("tailor-no-changes"))).toBeVisible();
    const own = [GUEST_RESUME.generatedSummary, ...descriptionToBullets(GUEST_RESUME.experience[0].description)];
    for (const was of await dialog.getByText(/^Was: /).allTextContents()) {
      expect(own, `${pass} draft`).toContain(was.replace(/^Was: /, ""));
    }
    const footer = dialog.getByTestId("local-customize-close").locator("..");
    await expect(footer.getByRole("button")).toHaveText(["Close", "Copy", "Download PDF"]);
    await dialog.getByTestId("local-customize-close").click();
    await expect(dialog).toBeHidden();
  }

  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), LOCAL_AI_RESUME_KEY);
  expect(stored?.data?.generatedSummary).toBe(GUEST_RESUME.generatedSummary);
  expect(stored?.data?.experience?.[0]?.description).toBe(GUEST_RESUME.experience[0].description);
  expect(diagnostics.pageErrors).toEqual([]);
});

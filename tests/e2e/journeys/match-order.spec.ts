import type { Page } from "@playwright/test";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { PACKS_HOME_INTRO_KEY } from "../../../src/lib/jobs/for-you/packs-home-intro";
import { LOCAL_AI_RESUME_KEY } from "../../../src/lib/local-ai/resume-storage";
import { expect, test } from "./fixtures";

/**
 * Journeys for how a résumé orders its matches — see tests/journeys/CATALOG.md (J-JOBS-90/91/92).
 * Read-only: the résumé lives in localStorage and the search answer is replaced in the browser.
 *
 * Reported 2026-09-30 with a Technical Account Manager résumé: "I don't even see a single TAM
 * role in my list". Every searched title scored full relevance because its words all appear
 * somewhere in the résumé, so senior Product Manager postings tied with TAM postings and won on
 * level. The candidate's own role now ranks first and a neighbouring role can't read Strong.
 */

const returningVisitor = (page: Page) =>
  page.addInitScript((key) => localStorage.setItem(key, "1"), ONBOARDING_COMPLETED_STORAGE_KEY);

/** Fabricated candidate (no real person): a Toronto TAM whose résumé also says "product" and "manager". */
const TAM_RESUME = {
  profile: { name: "Morgan Lee", profession: "Technical Account Manager", yearsOfExperience: 9, location: "Toronto, Ontario, Canada", email: "morgan.lee.e2e@example.com", phone: "555-010-4477", linkedin: "", website: "" },
  experience: [
    { id: "exp1", company: "Northwind Cloud", role: "Technical Account Manager", dates: "2019 - Present", description: "Owned adoption, renewals and technical escalations for 40 enterprise accounts; worked with product managers on the roadmap." },
    { id: "exp2", company: "Maple Systems", role: "Technical Support Engineer", dates: "2015 - 2019", description: "Resolved API and integration issues for enterprise customers." },
  ],
  competencies: [{ category: "Skills", skills: ["Customer Success", "Product Management", "SQL", "REST APIs", "Salesforce"] }],
  education: [{ id: "edu1", degree: "B.Eng. Computer Engineering", institution: "State University", year: "2015" }],
  generatedSummary: "Technical Account Manager with nine years in customer success and product delivery for enterprise SaaS customers.",
};

const seedResume = (page: Page) =>
  page.addInitScript(
    ([resumeKey, resume]) => {
      localStorage.setItem(resumeKey as string, JSON.stringify({ data: resume, updatedAt: new Date().toISOString(), sourceLabel: "e2e-synthetic" }));
    },
    [LOCAL_AI_RESUME_KEY, TAM_RESUME] as const,
  );

const posting = (id: string, title: string, company: string, experience_level: string) => ({
  id,
  title,
  company,
  company_domain: null,
  location: "Toronto, ON",
  location_city: "Toronto",
  location_state: "Ontario",
  location_country: "Canada",
  work_type: "hybrid",
  description: null,
  employment_type: "full_time",
  experience_level,
  salary_min: null,
  salary_max: null,
  salary_currency: null,
  salary_period: null,
  visa_sponsorship: null,
  tags: [],
  apply_url: "https://example.com/apply",
  source: "journey",
  posted_at: new Date(Date.now() - 86_400_000).toISOString(),
  first_seen_at: null,
  updated_at: null,
  vacancy_status: "open",
  ghost_badge: "unscored",
});

/**
 * What the TAM résumé's search returned in the report: senior PM postings first, TAM postings
 * after them. Before the fix the three PMs scored 100 (Strong) and filled the guest's top 3.
 */
const LISTED = [
  posting("11111111-0000-4000-8000-000000000001", "Senior Product Manager, Payments", "Harbor Pay", "senior"),
  posting("11111111-0000-4000-8000-000000000002", "Staff Product Manager, Platform", "Lumen Analytics", "senior"),
  posting("11111111-0000-4000-8000-000000000003", "Senior Product Manager - Growth", "Cedar Health", "senior"),
  posting("11111111-0000-4000-8000-000000000004", "Customer Success Manager", "Orchard CRM", "mid"),
  posting("11111111-0000-4000-8000-000000000005", "Technical Account Manager", "Northstar Data", "mid"),
  posting("11111111-0000-4000-8000-000000000006", "Technical Account Manager II", "Quarry Software", "unknown"),
  posting("11111111-0000-4000-8000-000000000007", "Senior Technical Account Manager", "Beacon Security", "senior"),
];

/**
 * The list's search answers with LISTED, in the browser only: the action still runs, its answer
 * is replaced. Row 0 of the flight response is the action envelope (build id, "$@1"); row 1
 * carries the return value.
 */
const answerResumeSearch = (page: Page, listed = LISTED) =>
  page.route("**/*", async (route) => {
    const req = route.request();
    const body = req.postData() ?? "";
    // The list's first page (a guest's ranked Search reads the newest roles and orders them on the device).
    if (req.method() !== "POST" || !req.headers()["next-action"] || !body.includes('"withFacets":true') || !body.includes('"offset":0')) {
      return route.fallback();
    }
    const res = await route.fetch();
    const envelope = (await res.text()).split("\n")[0];
    const result = { hits: listed, total: listed.length, backend: "meilisearch", configured: true, searchId: "journey-tam" };
    return route.fulfill({ response: res, body: `${envelope}\n1:${JSON.stringify(result)}\n` });
  });

async function openRankedSearch(page: Page) {
  await returningVisitor(page);
  await seedResume(page);
  await answerResumeSearch(page);
  await page.goto("/jobs?view=search&sort=fit");
  await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 45_000 });
}

test("a TAM résumé's ranked Search list opens on TAM roles, not the senior PM roles its words also cover", { tag: ["@J-JOBS-90"] }, async ({ page, diagnostics }) => {
  await openRankedSearch(page);
  const titles = page.getByTestId("job-row").getByTestId("job-title");
  // A guest sees the top 3, then the fit gate. All three are the résumé's own role.
  await expect(titles).toHaveCount(3, { timeout: 30_000 });
  // Own role first, then by score: the senior one (100), the mid one (92), the unlabelled one (79).
  await expect(titles).toHaveText(["Senior Technical Account Manager", "Technical Account Manager", "Technical Account Manager II"]);
  await expect(page.getByTestId("job-row").filter({ hasText: /Product Manager/ })).toHaveCount(0);
  expect(diagnostics.pageErrors).toEqual([]);
});

test("pointing at a match label says in plain English why it is Strong, Good or Stretch", { tag: ["@J-JOBS-91"] }, async ({ page }) => {
  await openRankedSearch(page);
  const first = page.getByTestId("job-row").first();
  await expect(first.getByTestId("job-title")).toHaveText(/Technical Account Manager/, { timeout: 30_000 });
  const chip = first.getByTestId("match-chip");
  await expect(chip).toHaveText("Strong");
  // A thin list's "Broaden this search" counts arrive after the rows and push them down. Point at
  // the label once it has stopped moving, or the pointer lands beside it.
  let at = "";
  await expect
    .poll(
      async () => {
        const box = await chip.boundingBox();
        const now = box ? `${Math.round(box.x)},${Math.round(box.y)}` : "";
        const still = now !== "" && now === at;
        at = now;
        return still;
      },
      { intervals: [1_000], timeout: 30_000, message: "the match label stopped moving" },
    )
    .toBe(true);
  // Hover on desktop. A phone has no hover: a tap opens the reason and stays on it, not the row under it.
  const phone = test.info().project.name === "mobile";
  const reason = page.getByTestId("match-reason").first();
  if (phone) {
    await chip.tap();
    await expect(reason).toBeVisible({ timeout: 10_000 });
  } else {
    await expect(async () => {
      await page.mouse.move(0, 0);
      await chip.hover();
      await expect(reason).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
  }
  if (phone) expect(new URL(page.url()).searchParams.get("job")).toBeNull();
  await expect(reason).toContainText("It's your own role: the title matches Technical Account Manager on your résumé.");
  await expect(reason).toContainText(/its level fits your experience/i);
  // Readable on the tooltip's own (inverted) background: it once rendered white on white.
  const [ink, paper] = await reason.evaluate((el) => [getComputedStyle(el).color, getComputedStyle(el.closest("[data-side]") ?? document.body).backgroundColor]);
  expect(ink).not.toBe(paper);
});

/**
 * An opened pack for the same résumé, as ranked: its own role, a customer success role (the same
 * kind of work), then a Technical Support Manager (a title it can't tie to the résumé). Three
 * roles, the most a guest's pack shows.
 */
const PACK = [
  posting("22222222-0000-4000-8000-000000000001", "Technical Account Manager", "Northstar Data", "senior"),
  posting("22222222-0000-4000-8000-000000000002", "Senior Customer Success Manager", "Orchard CRM", "senior"),
  posting("22222222-0000-4000-8000-000000000003", "Technical Support Manager", "Fernway", "senior"),
];
const [TAM_ROLE, CSM_ROLE, SUPPORT_ROLE] = PACK.map((p) => p.id);

/** Open the packs hub's "all" pack. The hub paints before it hydrates, so tap until the pack opens. */
async function openPack(page: Page) {
  await page.goto("/jobs?view=for-you");
  const card = page.getByTestId("hub-pack-card-all");
  const back = page.getByTestId("jobs-back-to-packs");
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(async () => {
    if (!(await back.isVisible())) await card.click({ timeout: 5_000 });
    await expect(back).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
}

test("more or fewer like this on an open role reorders what comes next, hides nothing, says what it is tuned to and resets", { tag: ["@J-JOBS-92"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), PACKS_HOME_INTRO_KEY);
  await seedResume(page);
  await answerResumeSearch(page, PACK);
  await openPack(page);

  const stack = page.locator('[data-testid="for-you-deck"] [data-testid="role-stack"]');
  const front = stack.locator('[data-testid="role-stack-card"][data-stack-pose="front"]');
  const upcoming = stack.locator('[data-testid="role-stack-card"][data-stack-pose="upcoming"]');
  const position = page.getByTestId("for-you-deck-position");
  const tuned = page.getByTestId("deck-tuning");

  await expect(front).toHaveAttribute("data-job-id", TAM_ROLE, { timeout: 60_000 });
  await expect(upcoming).toHaveAttribute("data-job-id", CSM_ROLE);
  await expect(position).toHaveText("Role 1 of 3");
  await expect(tuned).toHaveCount(0);

  // More like this: the role stays open, nothing is hidden, the role most like it (the other
  // "Technical ... Manager") comes up next, and the deck says what it leans toward.
  const more = front.getByTestId("role-more-like-this");
  await more.click();
  await expect(more).toHaveAttribute("aria-pressed", "true");
  await expect(upcoming).toHaveAttribute("data-job-id", SUPPORT_ROLE);
  await expect(tuned).toContainText("Tuned toward Technical Account Manager.");
  await expect(position).toHaveText("Role 1 of 3");

  // Fewer like this: the open role goes, like Skip, and the deck leans away from it too.
  await page.getByTestId("for-you-next").click();
  await page.getByTestId("for-you-next").click();
  await expect(front).toHaveAttribute("data-job-id", CSM_ROLE);
  await front.getByTestId("role-fewer-like-this").click();
  await expect(position).toHaveText("Role 2 of 2");
  await expect(front).toHaveAttribute("data-job-id", SUPPORT_ROLE);
  await expect(tuned).toContainText("Tuned toward Technical Account Manager, away from Customer Success Manager.");

  // The nudges stay on this device: back on the pack, nothing is hidden, and the order still
  // leans their way.
  await page.reload();
  await openPack(page);
  await expect(front).toHaveAttribute("data-job-id", TAM_ROLE, { timeout: 60_000 });
  await expect(position).toHaveText("Role 1 of 3");
  await expect(front.getByTestId("role-more-like-this")).toHaveAttribute("aria-pressed", "true");
  await expect(upcoming).toHaveAttribute("data-job-id", SUPPORT_ROLE);
  await expect(tuned).toContainText("away from Customer Success Manager");

  // Reset drops every nudge: the ranked order comes back.
  await page.getByTestId("deck-tuning-reset").click();
  await expect(tuned).toHaveCount(0);
  await expect(upcoming).toHaveAttribute("data-job-id", CSM_ROLE);
  await expect(front.getByTestId("role-more-like-this")).toHaveAttribute("aria-pressed", "false");
  expect(diagnostics.pageErrors).toEqual([]);
});

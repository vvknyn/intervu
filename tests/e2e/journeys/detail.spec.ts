import type { Locator, Page } from "@playwright/test";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { LOCAL_AI_CONSENT_KEY } from "../../../src/lib/local-ai/consent";
import { LOCAL_AI_ENABLED_KEY } from "../../../src/lib/local-ai/flag";
import { stripHtmlLikeIngest } from "../../fixtures/job-descriptions/ingest-strip";
import { EXPEL_TAM_HTML } from "../../fixtures/job-descriptions/postings";
import { expect, test } from "./fixtures";
import { runSearch } from "./search-box";

/** Journeys for a job's detail — the job page and the board's pane — and opening and closing it from a row. See tests/journeys/CATALOG.md (J-DETAIL-11/29-33/37/41/42, J-JOBS-11/53/104). Read-only. */

const DETAIL = '[data-testid="detail-pane"]:visible, [data-testid="mobile-detail-scroller"]:visible';
/** The one "Customize résumé" (with a résumé) or "Upload résumé to customize" (without) button. */
const CUSTOMIZE = '[data-testid="local-customize-open"]:visible, [data-testid="job-detail-upload-to-customize"]:visible';

/** How far the page scrolls sideways; 0 when everything fits the screen. */
function sidewaysScroll(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** Labels of the buttons and links in `scope` that run past its right edge or the screen's. */
function spilled(scope: Locator) {
  return scope.evaluate((root) => {
    const edge = Math.min(document.documentElement.clientWidth, root.getBoundingClientRect().right);
    return [...root.querySelectorAll<HTMLElement>("button, a")]
      .filter((el) => el.offsetParent !== null && el.getBoundingClientRect().right > edge + 1)
      .map((el) => el.getAttribute("aria-label") || el.textContent!.trim());
  });
}

function isDesktop(page: Page) {
  return page.viewportSize()!.width >= 1024;
}

/** Waits until `target` holds still: the sheet grows as the job loads, which moves it. */
async function untilStill(target: Locator) {
  let last = "";
  await expect
    .poll(async () => {
      const now = JSON.stringify(await target.boundingBox());
      const still = now === last && now !== "null";
      last = now;
      return still;
    }, { intervals: [400], timeout: 20_000 })
    .toBe(true);
}

/** Clicks the open job's × (the split pane's own at 1440, the sheet's header at 390) once it holds still. */
async function closeJob(page: Page) {
  const surface = page.viewportSize()!.width >= 1280 ? page.getByTestId("detail-pane") : page.getByRole("dialog");
  const close = surface.getByRole("button", { name: "Close", exact: true }).first();
  await untilStill(close);
  await close.click();
}

/** Jobs come from a live search — pinned ids and slugs rot when listings expire. */
async function searchFor(page: Page, keyword: string) {
  await page.addInitScript((key) => localStorage.setItem(key, "1"), ONBOARDING_COMPLETED_STORAGE_KEY);
  await page.goto("/jobs");
  const input = page.getByPlaceholder("Job title, skill, or company");
  await input.fill(keyword);
  await runSearch(page, input);
  await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 30_000 });
}

/** Up to `n` job ids from a live search. */
async function liveJobIds(page: Page, keyword: string, n: number): Promise<string[]> {
  await searchFor(page, keyword);
  const ids = await page.getByTestId("job-row").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-job-id")));
  return [...new Set(ids.filter((id): id is string => Boolean(id)))].slice(0, n);
}

/** Up to `n` job page paths from a live search. */
async function liveJobPaths(page: Page, keyword: string, n: number): Promise<string[]> {
  await searchFor(page, keyword);
  const paths = await page
    .getByTestId("job-row")
    .locator('a[href^="/jobs/"]')
    .evaluateAll((links) => links.map((a) => a.getAttribute("href")));
  return [...new Set(paths.filter((p): p is string => Boolean(p)))].slice(0, n);
}

/** The first job page (of a few from a live search) whose "More like this" list rendered. */
async function jobPageWithRelated(page: Page): Promise<Locator> {
  for (const path of await liveJobPaths(page, "product manager", 3)) {
    await page.goto(path);
    const section = page.getByTestId("job-detail-related");
    if (await section.waitFor({ timeout: 20_000 }).then(() => true, () => false)) return section;
  }
  throw new Error("none of the first three job pages showed a More like this list");
}

test("the job page's More like this rows hold their two lines, and the heading names the list", { tag: ["@J-DETAIL-29"] }, async ({ page, diagnostics }) => {
  const section = await jobPageWithRelated(page);
  // "More like this" for similar roles; "More at {company}" when only the company's own roles came back.
  await expect(section.getByRole("heading")).toHaveText(/^More (like this|at .+)$/);
  const rows = await section.getByTestId("related-job-row").evaluateAll((els) =>
    els.map((el) => {
      const box = el.getBoundingClientRect();
      const title = el.querySelector('[data-testid="related-job-title"]')!;
      const lineEls = [...title.parentElement!.children];
      const lines = lineEls.map((c) => c.getBoundingClientRect());
      return {
        overflow: el.scrollHeight - el.clientHeight,
        // A pinned row squeezes its lines instead of overflowing: each one
        // (`truncate`, so overflow hidden) gets shorter than its own text.
        clipped: lineEls.some((c) => c.scrollHeight > c.clientHeight + 1),
        above: lines[0]!.top - box.top,
        below: box.bottom - lines[lines.length - 1]!.bottom,
        // The hover band and the focus ring are the row's box: the text sits inside it.
        inset: lines[0]!.left - box.left,
      };
    }),
  );
  expect(rows.length).toBeGreaterThan(0);
  // The regression: a 32px control step pinned each row, so its two lines
  // were squeezed flush against the hairlines and the hover band cut them off.
  for (const row of rows) {
    expect(row.overflow).toBeLessThanOrEqual(0);
    expect(row.clipped).toBe(false);
    expect(row.above).toBeGreaterThanOrEqual(8);
    expect(row.below).toBeGreaterThanOrEqual(8);
    expect(row.inset).toBeGreaterThanOrEqual(12);
  }

  // Keyboard focus draws an inset ring inside the row, not the browser outline over the text.
  const first = section.getByTestId("related-job-row").first();
  await first.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  const focus = await first.evaluate((el) => ({ active: document.activeElement === el, outline: getComputedStyle(el).outlineStyle, ring: getComputedStyle(el).boxShadow }));
  expect(focus.active).toBe(true);
  expect(focus.outline).toBe("none");
  expect(focus.ring).toMatch(/inset/);
  expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
  expect(diagnostics.serverErrors).toEqual([]);
});

test("a related row on the job page opens that job's own page, and Back returns", { tag: ["@J-DETAIL-11"] }, async ({ page }) => {
  const section = await jobPageWithRelated(page);
  const from = new URL(page.url()).pathname;
  const row = section.getByTestId("related-job-row").first();
  const title = (await row.getByTestId("related-job-title").textContent())!.trim();
  // A link to the job's page, not a button into the board (which it was until 2026-09-30).
  const href = (await row.getAttribute("href"))!;
  expect(href).toMatch(/^\/jobs\/[^/?#]+$/);
  await row.click();
  await expect(page).toHaveURL((url) => url.pathname === href, { timeout: 10_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title, { timeout: 20_000 });
  await page.goBack();
  await expect(page).toHaveURL((url) => url.pathname === from, { timeout: 10_000 });
});

/** The `{ jobs, basis }` a server action's flight response carries. */
function relatedFromFlight(text: string): { jobs: Array<{ location_country?: string | string[] | null }>; basis: string } {
  for (const line of text.split("\n")) {
    const json = line.replace(/^[0-9a-f]+:/, "");
    if (!json.startsWith("{")) continue;
    try {
      const value = JSON.parse(json);
      if (Array.isArray(value?.jobs)) return value;
    } catch {
      // not this line
    }
  }
  throw new Error(`no related list in the action response: ${text.slice(0, 200)}`);
}

test("More like this keeps a job's own country when its location is not a plain \"City, Country\"", { tag: ["@J-DETAIL-37"] }, async ({ page }) => {
  // A customer service job at "CA, Oakville 1, Office" listed only US roles:
  // its country field read the CA as California (2026-09-30). Live listings
  // with one exact location come and go, so a live job's request for its
  // related roles goes out carrying that job's place instead.
  const isRelatedRequest = (body: string | null) => {
    try {
      const [seed] = JSON.parse(body ?? "");
      return typeof seed === "object" && seed !== null && "companyDomain" in seed && "country" in seed;
    } catch {
      return false;
    }
  };
  let answered: (text: string) => void;
  const answer = new Promise<string>((resolve) => (answered = resolve));
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !request.headers()["next-action"] || !isRelatedRequest(request.postData())) return route.fallback();
    const [seed] = JSON.parse(request.postData()!);
    const response = await route.fetch({
      postData: JSON.stringify([{ ...seed, title: "Customer Service Representative", location: "CA, Oakville 1, Office", state: null, country: "US" }]),
    });
    answered(await response.text());
    await route.fulfill({ response });
  });
  const [path] = await liveJobPaths(page, "customer service", 1);
  await page.goto(path!);
  const related = relatedFromFlight(await answer);
  // Similar roles in Canada, not the company fallback an empty US search fell to.
  expect(related.basis).toBe("title");
  expect(related.jobs.length).toBeGreaterThan(0);
  const us = related.jobs.filter((job) => [job.location_country ?? []].flat().some((c) => /^(us|usa|united states)$/i.test(c.trim())));
  expect(us).toEqual([]);
  await expect(page.getByTestId("job-detail-related").getByRole("heading")).toHaveText("More like this", { timeout: 20_000 });
});

test("the pane's company links say where they go, never a bare company name", { tag: ["@J-DETAIL-30"] }, async ({ page }) => {
  // Only jobs with a hiring record show the links, so try a few.
  for (const id of await liveJobIds(page, "product manager", 3)) {
    await page.goto(`/jobs?posted=any&job=${encodeURIComponent(id)}`);
    const detail = page.locator(DETAIL).first();
    await expect(detail).toBeVisible({ timeout: 20_000 });
    const allJobs = detail.getByRole("link", { name: /^All jobs at / });
    if (!(await allJobs.waitFor({ timeout: 10_000 }).then(() => true, () => false))) continue;
    const links = await allJobs.locator("xpath=..").getByRole("link").allTextContents();
    for (const text of links) expect(text.trim()).toMatch(/^All jobs at .+|.+ company page$/);
    return;
  }
  test.skip(true, "none of the first three jobs had a hiring record to link from");
});

test("the job page shows its keywords and check rows on desktop, one tap away on a phone", { tag: ["@J-DETAIL-31"] }, async ({ page, diagnostics }) => {
  // A closed <details> hid them at every width, whatever `lg:!block` said (2026-09-30).
  const [path] = await liveJobPaths(page, "product manager", 1);
  await page.goto(path!);
  const receipt = page.getByTestId("job-detail-receipt");
  await expect(receipt).toBeVisible({ timeout: 20_000 });
  const checkRow = receipt.locator("b").first();
  const toggle = receipt.getByRole("button", { name: /^(Show|Hide) details$/ });
  if (isDesktop(page)) {
    await expect(checkRow).toBeVisible();
    await expect(toggle).toBeHidden();
    const keywords = page.getByTestId("job-detail-keywords");
    if ((await keywords.count()) > 0) await expect(keywords).toBeVisible();
  } else {
    await expect(checkRow).toBeHidden();
    await expect(toggle).toHaveText("Show details");
    await toggle.click();
    await expect(checkRow).toBeVisible();
    await expect(toggle).toHaveText("Hide details");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  }
  expect(diagnostics.pageErrors).toEqual([]);
});

test("the job page's actions fit the screen: Apply and Save in the phone bar, Upload or Customize in the page", { tag: ["@J-DETAIL-32"] }, async ({ page, diagnostics }) => {
  const [path] = await liveJobPaths(page, "product manager", 1);
  await page.goto(path!);
  // A guest has no résumé, so this is "Upload résumé to customize": one of them, on its own row.
  await expect(page.locator(CUSTOMIZE)).toHaveCount(1, { timeout: 20_000 });
  if (isDesktop(page)) {
    expect(await spilled(page.getByTestId("job-detail-apply-card"))).toEqual([]);
  } else {
    // It sat beside Apply and Save in the bar and ran about 100px off a 390px screen (2026-09-30).
    const bar = page.getByTestId("job-detail-action-bar");
    await expect(bar).toBeVisible();
    await expect(bar.locator(CUSTOMIZE)).toHaveCount(0);
    expect(await spilled(bar)).toEqual([]);
  }
  expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
  expect(diagnostics.pageErrors).toEqual([]);
});

test("the board's role view has one Upload or Customize button, and its phone bar fits the screen", { tag: ["@J-DETAIL-33"] }, async ({ page, diagnostics }) => {
  const [id] = await liveJobIds(page, "product manager", 1);
  await page.goto(`/jobs?posted=any&job=${encodeURIComponent(id!)}`);
  const detail = page.locator(DETAIL).first();
  await expect(detail).toBeVisible({ timeout: 20_000 });
  // The phone sheet repeated it in its sticky bar, which then ran off the screen (2026-09-30).
  await expect(detail.locator(CUSTOMIZE)).toHaveCount(1, { timeout: 20_000 });
  if (!isDesktop(page)) {
    const bar = detail.getByTestId("job-detail-action-bar");
    await expect(bar).toBeVisible();
    await expect(bar.locator(CUSTOMIZE)).toHaveCount(0);
    expect(await spilled(bar)).toEqual([]);
  }
  expect(diagnostics.pageErrors).toEqual([]);
});

test("closing a job opened from a shared link stays on /jobs with ?job= cleared; one opened from the list steps back", { tag: ["@J-JOBS-11"] }, async ({ page, context, diagnostics }) => {
  const [id] = await liveJobIds(page, "product manager", 1);
  // From the list: the open pushed ?job=, so the close is Back to the search it came from.
  const listUrl = page.url();
  await page.getByTestId("job-row").first().getByTestId("job-title").click();
  await expect(page).toHaveURL(/[?&]job=/, { timeout: 10_000 });
  await closeJob(page);
  await expect(page).toHaveURL(listUrl, { timeout: 10_000 });

  // A shared link in a fresh tab has no page of ours before it: the × went Back off the site, or did nothing (2026-09-30).
  const shared = await context.newPage();
  await shared.goto(`/jobs?posted=any&job=${encodeURIComponent(id!)}`);
  const detail = shared.locator(DETAIL).first();
  await expect(detail).toBeVisible({ timeout: 20_000 });
  // The job stays open once the list has loaded: on a dev server the second run of the list's fetch closed it about 3s in (2026-10-01).
  await shared.waitForLoadState("networkidle");
  await expect(detail).toBeVisible();
  expect(new URL(shared.url()).searchParams.get("job")).toBe(id);
  await closeJob(shared);
  await expect(shared).toHaveURL((url) => url.pathname === "/jobs" && url.searchParams.get("posted") === "any" && !url.searchParams.has("job"), { timeout: 10_000 });
  if (!isDesktop(shared)) await expect(shared.getByTestId("mobile-detail-scroller")).toBeHidden();
  // Nothing searched and no job open: /jobs is the front door, search box and résumé band, no rows.
  await expect(shared.getByPlaceholder("Job title, skill, or company").first()).toBeVisible({ timeout: 30_000 });
  await expect(shared.locator('section[aria-label="Add your resume"]')).toBeVisible({ timeout: 15_000 });
  await expect(shared.getByTestId("job-row")).toHaveCount(0);
  expect(diagnostics.pageErrors).toEqual([]);
});

test("on a phone a tap anywhere on a job row opens that job, and the job links its company page", { tag: ["@J-JOBS-53"] }, async ({ page, diagnostics }) => {
  await searchFor(page, "data analyst");
  // A row whose company has a page: its name is a link from lg up.
  const row = page.getByTestId("job-row").filter({ has: page.getByTestId("job-row-company") }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  const id = (await row.getAttribute("data-job-id"))!;
  const company = row.getByTestId("job-row-company");
  if (isDesktop(page)) {
    await expect(company).toBeVisible();
    await company.click();
    await expect(page).toHaveURL(/\/co\//, { timeout: 20_000 });
    return;
  }
  // The name filled the middle of a phone row, so a tap there opened the company page (2026-09-30).
  await expect(company).toBeHidden();
  await row.click();
  await expect(page).toHaveURL((url) => url.pathname === "/jobs" && url.searchParams.get("job") === id, { timeout: 10_000 });
  const sheet = page.getByTestId("mobile-detail-scroller");
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('a[href^="/co/"]').first()).toBeVisible({ timeout: 20_000 });
  expect(diagnostics.pageErrors).toEqual([]);
});

test("on a phone a job's sheet closes when dragged down by its handle, a short drag springs back, and a tap that drifts still follows a link", { tag: ["@J-JOBS-104"] }, async ({ page, diagnostics }, testInfo) => {
  test.skip(!testInfo.project.use.hasTouch, "a drag on the sheet needs a touch screen");
  await searchFor(page, "data analyst");
  const listUrl = page.url();
  // A row whose company has a page, so the open job holds a link to tap.
  const row = page.getByTestId("job-row").filter({ has: page.getByTestId("job-row-company") }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  const sheet = page.getByRole("dialog");
  const openRow = async () => {
    await row.getByTestId("job-title").click();
    await expect(page).toHaveURL(/[?&]job=/, { timeout: 10_000 });
    await untilStill(sheet);
  };
  await openRow();
  const openUrl = page.url();

  const cdp = await page.context().newCDPSession(page);
  /** A finger put down at (x, y), moved `dy` px down in `steps` moves, and lifted. */
  const touch = async (x: number, y: number, dy: number, steps: number) => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (let i = 1; i <= steps; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + (dy * i) / steps }] });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  const dragHandle = async (dy: number) => {
    const box = (await sheet.boundingBox())!;
    await touch(box.x + box.width / 2, box.y + 12, dy, 10);
  };

  // A short drag springs back: the same job stays open.
  await dragHandle(30);
  await untilStill(sheet);
  await expect(sheet).toBeVisible();
  expect(page.url()).toBe(openUrl);

  // A long one closes it like the × does, Back to the search. Every phone sheet ignored the drag (2026-10-03).
  await dragHandle(320);
  await expect(page).toHaveURL(listUrl, { timeout: 10_000 });
  await expect(page.getByTestId("mobile-detail-scroller")).toBeHidden();

  // A tap on the company link that drifts 4px down is still a tap: once the drag
  // was wired up, any downward nudge took the pointer and the link never opened.
  await openRow();
  const company = page.getByTestId("mobile-detail-scroller").locator('a[href^="/co/"]').first();
  await expect(company).toBeVisible({ timeout: 20_000 });
  const link = (await company.boundingBox())!;
  await touch(link.x + link.width / 2, link.y + link.height / 2, 4, 2);
  await expect(page).toHaveURL(/\/co\//, { timeout: 20_000 });
  expect(diagnostics.pageErrors).toEqual([]);
});

/** Opens a live job in the board (pane on desktop, sheet on a phone) with `description` served as its text, and returns its description. */
async function openJobWithDescription(page: Page, description: string): Promise<Locator> {
  await page.route("**/api/jobs/*/description", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    if (body?.hits?.[0]) body.hits[0].description = description;
    await route.fulfill({ response, json: body });
  });
  const [id] = await liveJobIds(page, "product manager", 1);
  await page.goto(`/jobs?posted=any&job=${encodeURIComponent(id!)}`);
  const detail = page.locator(DETAIL).first();
  await expect(detail).toBeVisible({ timeout: 20_000 });
  const more = detail.getByRole("button", { name: "Show full description" });
  if (await more.waitFor({ timeout: 5_000 }).then(() => true, () => false)) await more.click();
  return detail.getByTestId("job-description-body");
}

test("a posting whose lists and titles arrived as plain lines reads as headings, lists and fine print", { tag: ["@J-DETAIL-41"] }, async ({ page, diagnostics }) => {
  // Vivek's screenshot (2026-09-30): an Expel TAM role showed every duty and
  // requirement as its own paragraph and "What you should bring with you" as
  // body text, because ingest turns <li> and <strong> titles into bare lines.
  const body = await openJobWithDescription(page, stripHtmlLikeIngest(EXPEL_TAM_HTML));
  await expect(body.getByRole("heading")).toHaveText(["About Expel", "What you’ll do", "What you should bring with you", "Compensation"], { timeout: 20_000 });
  await expect(body).toHaveAttribute("data-layout", "rules");
  const lists = body.getByRole("list");
  await expect(lists).toHaveCount(2);
  await expect(lists.nth(0).getByRole("listitem")).toHaveCount(5);
  await expect(lists.nth(1).getByRole("listitem")).toHaveCount(4);
  await expect(lists.nth(1).getByRole("listitem").first()).toHaveText(/^5\+ years of security industry experience/);
  // Pay reads at full size; the equal-opportunity notice steps down.
  const size = (text: string) => body.locator("p", { hasText: text }).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  const pay = await size("$150,000");
  expect(await size("equal opportunity employer")).toBeLessThan(pay);
  expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
  expect(diagnostics.pageErrors).toEqual([]);
});

test("the on-device model lays out the lines the rules guessed, never holds the text back, and the original is one tap away", { tag: ["@J-DETAIL-42"] }, async ({ page, diagnostics }) => {
  const lines = [
    "What we need",
    "You have five years of B2B sales experience.",
    "You have closed deals above $100,000.",
    "You are based in Toronto.",
    "Compensation: $90,000 base plus commission.",
  ];
  await page.addInitScript(
    ([enabledKey, consentKey]) => {
      localStorage.setItem(enabledKey, "1");
      localStorage.setItem(consentKey, "1");
      // A stand-in for Chrome's Prompt API that answers only when the test says
      // so: short titles H, "You have/are…" lines B, the rest P.
      const w = window as unknown as { __prompts: string[]; __answer: () => void; LanguageModel: unknown };
      let answer!: () => void;
      const answered = new Promise<void>((resolve) => (answer = resolve));
      w.__prompts = [];
      w.__answer = () => answer();
      const session = {
        async prompt(prompt: string) {
          w.__prompts.push(prompt);
          await answered;
          return prompt
            .split("Posting lines:\n")[1]!
            .split("\n")
            .map((line) => {
              const [n, ...rest] = line.split(" ");
              const text = rest.join(" ");
              return `${n} ${/^You (have|are)/.test(text) ? "B" : text.length < 40 && !text.endsWith(".") ? "H" : "P"}`;
            })
            .join("\n");
        },
        async clone() {
          return session;
        },
        destroy() {},
      };
      w.LanguageModel = { create: async () => session };
    },
    [LOCAL_AI_ENABLED_KEY, LOCAL_AI_CONSENT_KEY],
  );
  const body = await openJobWithDescription(page, lines.join("\n\n"));
  // The rules' layout shows at once while the model is still working.
  await expect(body.getByText(lines[1]!)).toBeVisible({ timeout: 20_000 });
  await expect(body).toHaveAttribute("data-layout", "rules");
  await expect(body.getByRole("listitem")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __prompts: string[] }).__prompts.length), { timeout: 20_000 }).toBe(1);

  await page.evaluate(() => (window as unknown as { __answer: () => void }).__answer());
  await expect(body).toHaveAttribute("data-layout", "device", { timeout: 20_000 });
  // Word for word: the model only chose which lines are list items.
  await expect(body.getByRole("listitem")).toHaveText(lines.slice(1, 4));
  await expect(body.getByRole("heading", { name: "What we need" })).toBeVisible();
  await expect(body.getByText("Laid out on your device.")).toBeVisible();

  await body.getByRole("button", { name: "Show original text" }).click();
  await expect(body.getByTestId("job-description-original")).toHaveText(lines.join("\n\n"), { useInnerText: true });
  await expect(body.getByRole("listitem")).toHaveCount(0);
  await body.getByRole("button", { name: "Show formatted" }).click();
  await expect(body.getByRole("listitem")).toHaveCount(3);

  // This browser remembers the layout: the next view needs no model call.
  await page.reload();
  const again = page.locator(DETAIL).first().getByTestId("job-description-body");
  await expect(again).toHaveAttribute("data-layout", "device", { timeout: 20_000 });
  expect(await page.evaluate(() => (window as unknown as { __prompts: string[] }).__prompts.length)).toBe(0);
  expect(diagnostics.pageErrors).toEqual([]);
});

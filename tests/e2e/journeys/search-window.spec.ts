import type { Page } from "@playwright/test";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { expect, test } from "./fixtures";

/**
 * Journeys for what a typed search reaches and in what order (2026-09-30):
 * the 90-day posted default (J-JOBS-04, J-FILT-02, J-FILT-25, J-FILT-26), the
 * IP-country default's remote-anywhere rule (J-SRCH-22), newer first among
 * equally matching roles (J-SRCH-23), and the job page's "checked" date
 * (J-DETAIL-40). See tests/journeys/CATALOG.md. Read-only.
 *
 * Every data-dependent journey reads live results and skips, saying why,
 * when the data it needs is not there — never a pinned id or date.
 */

const SEARCH_INPUT = "Job title, skill, or company";
const DAY_MS = 86_400_000;

type Hit = {
  id: string;
  title: string;
  posted_ts?: number | null;
  work_type?: string | null;
  location_country?: string | string[] | null;
  location_city?: string | null;
  location_state?: string | null;
  first_seen_at?: string | null;
  ghost_checked_at?: string | null;
  last_observed_alive_at?: string | null;
};
type SearchResult = { hits: Hit[]; total: number; defaultedLocation?: string; remoteAnywhere?: boolean };

const returningVisitor = (page: Page) =>
  page.addInitScript((key) => localStorage.setItem(key, "1"), ONBOARDING_COMPLETED_STORAGE_KEY);

/**
 * Every search result a Server Action returns while the page is open. Row 0
 * of an action response is the envelope; row 1 carries the return value
 * (the same shape J-JOBS-52's outage stub writes).
 */
function collectSearchResults(page: Page): SearchResult[] {
  const out: SearchResult[] = [];
  page.on("response", async (res) => {
    const req = res.request();
    if (req.method() !== "POST" || !req.headers()["next-action"]) return;
    const text = await res.text().catch(() => "");
    for (const line of text.split("\n")) {
      if (!line.startsWith("1:")) continue;
      try {
        const value = JSON.parse(line.slice(2)) as SearchResult;
        if (value && Array.isArray(value.hits)) out.push(value);
      } catch {
        // not a JSON row
      }
    }
  });
  return out;
}

/**
 * Types `q` into the board's search box and returns the result the rows on
 * screen came from — or `null` when the search shows its no-results state.
 */
async function typedSearch(page: Page, q: string): Promise<SearchResult | null> {
  await returningVisitor(page);
  const results = collectSearchResults(page);
  await page.goto("/jobs");
  const rows = page.getByTestId("job-row");
  const empty = page.getByTestId("search-empty-results");
  // Let the landing list's own read land first, so it is never mistaken for the search's.
  await expect(rows.first().or(empty).first()).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  const before = results.length;
  await page.getByPlaceholder(SEARCH_INPUT).fill(q);
  await page.getByTestId("search-submit").click();
  await expect(page).toHaveURL(/[?&]q=/, { timeout: 30_000 });
  let shown: SearchResult | null = null;
  await expect
    .poll(
      async () => {
        const fresh = results.slice(before);
        if (fresh.some((r) => r.hits.length === 0) && (await empty.isVisible())) return true;
        const ids = (await rows.evaluateAll((els) => els.map((el) => el.getAttribute("data-job-id")))).filter(Boolean).slice(0, 5);
        shown = fresh.find((r) => ids.length > 0 && ids.every((id) => r.hits.some((h) => h.id === id))) ?? null;
        return shown !== null;
      },
      { timeout: 45_000, message: "the search result behind the rows on screen" },
    )
    .toBe(true);
  return shown;
}

/** `[id, "posted-age" text]` for every rendered row. */
async function rowAges(page: Page): Promise<{ id: string; age: string }[]> {
  return page.getByTestId("job-row").evaluateAll((els) =>
    els.map((el) => ({
      id: el.getAttribute("data-job-id") ?? "",
      age: el.querySelector('[data-testid="posted-age"]')?.textContent?.trim() ?? "",
    })),
  );
}

/** Row ages as `postedAgeShort` writes them: "today", "Nd ago" (<30 days), "Nmo ago", "Ny ago". */
const withinThirtyDays = (age: string) => age === "today" || /^\d+d ago$/.test(age);
const thirtyOneToNinetyDays = (age: string) => /^[12]mo ago$/.test(age);
const olderThanNinetyDays = (age: string) => /^([3-9]|1[01])mo ago$/.test(age) || /y ago$/.test(age);

/** "5,820 roles from …" → 5820; "100,000+ roles" (a floor) → null. */
function exactCount(line: string): number | null {
  const m = /^([\d,]+)(\+)? roles?\b/.exec(line.trim());
  return m && !m[2] ? Number(m[1].replace(/,/g, "")) : null;
}

const countries = (h: Hit) =>
  (Array.isArray(h.location_country) ? h.location_country : [h.location_country]).filter((c): c is string => Boolean(c && c.trim()));

test("a typed search with no posted param applies and states the 90-day window", { tag: ["@J-JOBS-04", "@J-FILT-02"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await page.goto("/jobs?q=software+engineer");
  await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("result-line")).toContainText(/^[\d,]+\+? roles? from the last 90 days/, { timeout: 30_000 });
  // The Posted control names the applied default, not "Any date" and not the old month.
  await expect(page.getByTestId("facet-chip-posted").first()).toHaveText(/Posted · Past 3 months/);
  expect(new URL(page.url()).searchParams.get("posted")).toBeNull();
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

test("a typed search reaches a role posted 31-90 days ago by default, and Past month hides it", { tag: ["@J-FILT-25"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  // Salary order does not follow posting date, so page 1 mixes ages.
  let found: { id: string; age: string } | undefined;
  for (const q of ["data analyst", "product manager", "manager"]) {
    await page.goto(`/jobs?q=${encodeURIComponent(q)}&sort=salary`);
    await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("result-line")).toContainText("from the last 90 days", { timeout: 30_000 });
    const rows = await rowAges(page);
    expect(rows.filter((r) => olderThanNinetyDays(r.age)), "nothing older than the 90-day default").toEqual([]);
    found = rows.find((r) => thirtyOneToNinetyDays(r.age));
    if (found) break;
  }
  test.skip(!found, "no role posted 31-90 days ago on page 1 of any sample query");

  await page.getByTestId("facet-chip-posted").first().click();
  await page.getByRole("radio", { name: "Past month" }).click();
  await expect(page).toHaveURL(/[?&]posted=30d\b/, { timeout: 30_000 });
  await expect(page.getByTestId("result-line")).toContainText("from the last 30 days", { timeout: 30_000 });
  await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(`[data-testid="job-row"][data-job-id="${found!.id}"]`)).toHaveCount(0);
  const narrowed = await rowAges(page);
  expect(narrowed.filter((r) => !withinThirtyDays(r.age)), "every row inside 30 days").toEqual([]);
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

test("a ?posted=30d link still narrows to 30 days and keeps its posted param", { tag: ["@J-FILT-26"] }, async ({ page, diagnostics }) => {
  await returningVisitor(page);
  await page.goto("/jobs?q=data+analyst");
  const line = page.getByTestId("result-line");
  await expect(line).toContainText("from the last 90 days", { timeout: 30_000 });
  const defaultCount = exactCount((await line.textContent()) ?? "");

  await page.goto("/jobs?q=data+analyst&posted=30d");
  await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 30_000 });
  await expect(line).toContainText("from the last 30 days", { timeout: 30_000 });
  await expect(page.getByTestId("facet-chip-posted").first()).toHaveText(/Posted · Past month/);
  expect(new URL(page.url()).searchParams.get("posted")).toBe("30d");
  const rows = await rowAges(page);
  expect(rows.filter((r) => !withinThirtyDays(r.age)), "every row inside 30 days").toEqual([]);
  const narrowCount = exactCount((await line.textContent()) ?? "");
  if (defaultCount !== null && narrowCount !== null) expect(narrowCount).toBeLessThanOrEqual(defaultCount);
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

test("the country default leaves out a remote role with a city but no country, and still lists remote-anywhere roles", { tag: ["@J-SRCH-22"] }, async ({ page, diagnostics }) => {
  // "remote" in the query is read as the Remote work mode, so page 1 is all
  // remote roles: the default country's, plus remote roles with no place.
  // The second query is the reported case (a UK "Digital Data Analyst" in a
  // Canada search), which puts such a role on page 1 wherever one exists.
  let anywhereShown: { id: string; q: string } | undefined;
  for (const q of ["data analyst remote", "digital data analyst remote"]) {
    const result = await typedSearch(page, q);
    if (!result) continue;
    test.skip(!result.defaultedLocation, "no IP country default applied to this client");
    expect(result.remoteAnywhere).toBe(true);

    const cityOrStateButNoCountry = result.hits
      .filter((h) => countries(h).length === 0 && (Boolean(h.location_city?.trim()) || Boolean(h.location_state?.trim())))
      .map((h) => `${h.title} (${[h.location_city, h.location_state].filter(Boolean).join(", ")})`);
    expect(cityOrStateButNoCountry, `"${q}": a remote role naming a city or state but no country is not 'anywhere'`).toEqual([]);

    const anywhere = result.hits.find((h) => countries(h).length === 0 && !h.location_city?.trim() && !h.location_state?.trim());
    if (anywhere && !anywhereShown) {
      await expect(page.locator(`[data-testid="job-row"][data-job-id="${anywhere.id}"]`)).toHaveCount(1);
      anywhereShown = { id: anywhere.id, q };
    }
  }
  test.skip(!anywhereShown, "no remote role with no place at all on page 1 of either query");
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

test("among equally matching roles, the newer posting comes first", { tag: ["@J-SRCH-23"] }, async ({ page, diagnostics }) => {
  const result = await typedSearch(page, "data analyst");
  test.skip(!result, "no results for the sample query");
  // Same title = same match on every ranking rule that decides relevance, so
  // same-titled rows on one page must run newest first (undated rows last).
  const ts = (h: Hit) => (typeof h.posted_ts === "number" ? h.posted_ts : Number.NEGATIVE_INFINITY);
  const day = (t: number) => (Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : "undated");
  const oldestSoFar = new Map<string, number>();
  const outOfOrder: string[] = [];
  let pairs = 0;
  for (const hit of result!.hits) {
    const key = hit.title.trim().toLowerCase();
    const oldest = oldestSoFar.get(key);
    if (oldest !== undefined) {
      pairs++;
      if (ts(hit) > oldest) outOfOrder.push(`"${hit.title}" posted ${day(ts(hit))} listed after one posted ${day(oldest)}`);
    }
    oldestSoFar.set(key, oldest === undefined ? ts(hit) : Math.min(oldest, ts(hit)));
  }
  test.skip(pairs === 0, "no two rows on page 1 share a title");
  expect(outOfOrder).toEqual([]);
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

/** `formatRelativeAge` (freshness.ts), as the receipt prints it. */
function relativeAge(iso: string, nowMs: number): string {
  const ms = Math.max(0, nowMs - Date.parse(iso));
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < DAY_MS) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / DAY_MS)}d ago`;
}

test("the job page's posting check shows the later of the two check dates", { tag: ["@J-DETAIL-40"] }, async ({ page, diagnostics }) => {
  let pick: { hit: Hit; later: string; older: string } | undefined;
  for (const q of ["product manager", "data analyst"]) {
    const result = await typedSearch(page, q);
    const now = Date.now();
    for (const hit of result?.hits ?? []) {
      const checked = hit.ghost_checked_at;
      const alive = hit.last_observed_alive_at;
      if (!checked || !alive || Number.isNaN(Date.parse(checked)) || Number.isNaN(Date.parse(alive))) continue;
      // The case the old `alive || checked` got wrong: the alive stamp is the OLDER one.
      if (Date.parse(alive) >= Date.parse(checked)) continue;
      if (relativeAge(alive, now) === relativeAge(checked, now)) continue;
      // "Verified on intake" replaces the age when the only check was at intake, over a week ago.
      const firstSeen = hit.first_seen_at ? Date.parse(hit.first_seen_at) : NaN;
      if (!Number.isNaN(firstSeen) && Math.abs(Date.parse(checked) - firstSeen) < 3_600_000 && now - Date.parse(checked) > 7 * DAY_MS) continue;
      pick = { hit, later: checked, older: alive };
      break;
    }
    if (pick) break;
  }
  test.skip(!pick, "no role on page 1 whose ghost check is newer than its alive stamp by a visible margin");

  const href = await page.locator(`[data-testid="job-row"][data-job-id="${pick!.hit.id}"] a[href^="/jobs/"]`).first().getAttribute("href");
  expect(href).toBeTruthy();
  const before = Date.now();
  await page.goto(href!);
  const receipt = page.getByTestId("job-detail-receipt");
  await expect(receipt).toBeVisible({ timeout: 30_000 });
  const after = Date.now();
  const expected = [...new Set([relativeAge(pick!.later, before), relativeAge(pick!.later, after)])];
  const text = (await receipt.textContent()) ?? "";
  expect(expected.some((age) => text.includes(`checked ${age}`)), `receipt "${text.slice(0, 160)}" names checked ${expected.join(" / ")}`).toBe(true);
  const stale = relativeAge(pick!.older, after);
  if (!expected.includes(stale)) expect(text).not.toContain(`checked ${stale}`);
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

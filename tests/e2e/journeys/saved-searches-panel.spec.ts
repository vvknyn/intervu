import type { Page } from "@playwright/test";
import { SAVED_SEARCHES_KEY } from "../../../src/lib/jobs/saved-searches";
import { expect, test } from "./fixtures";

/**
 * J-ALERTS-49. The saved-search panel's "N new" counts are fetched once per distinct set of saved
 * searches. The panel's list is rebuilt on every render, and keying the count effect on that array
 * made every reply re-render, re-run the effect and ask again, without end (v20, Oct 25 2026).
 */

// React's dev StrictMode mounts every effect twice, so a dev server asks up to twice per search; a loop never stops.
/**
 * Counts React commits through the devtools hook React looks for at startup. A settled page
 * commits a few times a second at most while the machine is busy (a dev server under three
 * parallel workers measured 36 per 10 s); the loop committed 54,000 to 137,000 per 10 s on
 * staging. 100 clears the first and sits 540x under the second. A loop that re-asks the
 * server instead of re-rendering is caught by the exact server-action count below.
 */
const COMMIT_BOUND = 100;
const countCommits = (page: Page) =>
  page.addInitScript(() => {
    const w = window as unknown as { __commits: number; __REACT_DEVTOOLS_GLOBAL_HOOK__: unknown };
    w.__commits = 0;
    w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true,
      renderers: new Map(),
      inject: () => 1,
      onCommitFiberRoot: () => void w.__commits++,
      onCommitFiberUnmount() {},
      onPostCommitFiberRoot() {},
      checkDCE() {},
    };
  });
/** Waits for a 2 s quiet spell (a cold dev server commits while lazy chunks arrive), then returns the count. A loop never has one. */
async function settledCommits(page: Page): Promise<number> {
  let last = await commits(page);
  for (let quiet = 0; quiet < 4; ) {
    await page.waitForTimeout(500);
    const now = await commits(page);
    quiet = now === last ? quiet + 1 : 0;
    last = now;
  }
  return last;
}
const commits = (page: Page) => page.evaluate(() => (window as unknown as { __commits: number }).__commits);

const strictAsks = (n: number) => n * 2;

const guestSearch = (id: string, q: string) => ({ id, name: q, href: `?q=${q}`, createdAt: "2026-10-01T00:00:00.000Z" });

async function openWithSaved(page: Page, saved: ReturnType<typeof guestSearch>[]) {
  await countCommits(page);
  // An empty answer keeps the page still: the local search backend is often down, and its retry notice animates.
  await page.route("**/api/jobs/search", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ hits: [], total: 0, backend: "meilisearch", configured: true, searchId: "e2e-idle" }) }),
  );
  await page.addInitScript(([key, list]) => localStorage.setItem(key, list), [SAVED_SEARCHES_KEY, JSON.stringify(saved)] as const);
  const asks = { count: 0 };
  page.on("request", (req) => {
    if (req.method() === "POST" && req.headers()["next-action"] && (req.postData() ?? "").includes('"scope":"saved"')) asks.count++;
  });
  await page.goto("/jobs?q=engineer");
  // The panel mounts with the search box, whether or not the list has answered.
  if (saved.length) await expect(page.getByTestId("saved-search-item")).toHaveCount(saved.length, { timeout: 60_000 });
  return asks;
}

for (const saved of [[], [guestSearch("a", "engineer"), guestSearch("b", "designer")]]) {
  test(`${saved.length} saved searches: the counts are asked for once each and 10 s idle commits stay under the bound`, { tag: ["@J-ALERTS-49"] }, async ({ page, diagnostics }) => {
    const asks = await openWithSaved(page, saved);
    const c0 = await settledCommits(page);
    const settled = asks.count;
    await page.waitForTimeout(10_000);
    expect(await commits(page)).toBeLessThanOrEqual(c0 + COMMIT_BOUND);
    expect(asks.count).toBe(settled);
    expect(settled).toBeLessThanOrEqual(strictAsks(saved.length));
    expect(settled).toBeGreaterThanOrEqual(saved.length);
    expect(diagnostics.pageErrors).toEqual([]);
    expect(diagnostics.consoleErrors.filter((e) => /Maximum update depth/.test(e))).toEqual([]);
  });
}

test("removing one of two saved searches asks again once, for the one left", { tag: ["@J-ALERTS-49"] }, async ({ page }) => {
  const asks = await openWithSaved(page, [guestSearch("a", "engineer"), guestSearch("b", "designer")]);
  await page.waitForTimeout(3_000);
  const before = asks.count;
  await page.getByRole("button", { name: "Remove saved search designer" }).click();
  await expect(page.getByTestId("saved-search-item")).toHaveCount(1);
  await page.waitForTimeout(4_000);
  expect(asks.count - before).toBe(1);
});

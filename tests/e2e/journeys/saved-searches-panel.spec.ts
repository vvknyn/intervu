import type { Page, Request } from "@playwright/test";
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
const commits = (page: Page) => page.evaluate(() => (window as unknown as { __commits: number }).__commits);

/** Every next-action request the page makes: how many started, how many are still open, and how many asked for the saved-search counts. */
function trackActions(page: Page) {
  const t = { started: 0, open: 0, asks: 0 };
  const live = new Set<Request>();
  const done = (req: Request) => live.delete(req) && void t.open--;
  page.on("request", (req) => {
    if (req.method() !== "POST" || !req.headers()["next-action"]) return;
    t.started++;
    t.open++;
    live.add(req);
    if ((req.postData() ?? "").includes('"scope":"saved"')) t.asks++;
  });
  page.on("requestfinished", done);
  page.on("requestfailed", done);
  return t;
}

const QUIET_SAMPLES = 4; // 4 x 500 ms = a 2 s window
const SETTLE_BOUND_MS = 20_000;
/**
 * Settled = no React commit and no new next-action request, and none still in flight, for a 2 s window
 * (a cold dev server commits while lazy chunks arrive, and a count reply that lands late re-renders and can
 * start the next ask). A loop never has such a window, so the wait is bounded and fails with what the last
 * window measured instead of running into the test timeout.
 */
async function settle(page: Page, t: ReturnType<typeof trackActions>): Promise<{ commits: number }> {
  const samples: { c: number; started: number }[] = [];
  for (let quiet = 0, waited = 0; ; waited += 500) {
    const c = await commits(page);
    const prev = samples.at(-1);
    quiet = prev && prev.c === c && prev.started === t.started && t.open === 0 ? quiet + 1 : 0;
    samples.push({ c, started: t.started });
    if (quiet >= QUIET_SAMPLES) return { commits: c };
    if (waited >= SETTLE_BOUND_MS) {
      const first = samples[Math.max(0, samples.length - 1 - QUIET_SAMPLES)];
      throw new Error(
        `never settled in ${SETTLE_BOUND_MS / 1000} s: last 2 s window had ${c - first.c} commits and ${t.started - first.started} new next-action requests (${t.open} still open); a settled page has 0 / 0 / 0`,
      );
    }
    await page.waitForTimeout(500);
  }
}

const strictAsks = (n: number) => n * 2;

const guestSearch = (id: string, q: string) => ({ id, name: q, href: `?q=${q}`, createdAt: "2026-10-01T00:00:00.000Z" });

async function openWithSaved(page: Page, saved: ReturnType<typeof guestSearch>[]) {
  await countCommits(page);
  // An empty answer keeps the page still: the local search backend is often down, and its retry notice animates.
  await page.route("**/api/jobs/search", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ hits: [], total: 0, backend: "meilisearch", configured: true, searchId: "e2e-idle" }) }),
  );
  await page.addInitScript(([key, list]) => localStorage.setItem(key, list), [SAVED_SEARCHES_KEY, JSON.stringify(saved)] as const);
  const actions = trackActions(page);
  await page.goto("/jobs?q=engineer");
  // The panel mounts with the search box, whether or not the list has answered.
  if (saved.length) await expect(page.getByTestId("saved-search-item")).toHaveCount(saved.length, { timeout: 60_000 });
  return actions;
}

/**
 * Which assertion detects a loop, per case (margins measured on d3efeb6a's panel, 3 runs each, in the PR):
 * - 0 saved: the loop is a render loop with no server ask, so only the settle wait (never a quiet window) and
 *   the commit bound can see it. The settle wait is the detector; the bound is its backstop.
 * - 2 saved: the loop re-asks the server, with few commits per ask. The detector is the ask count: it must
 *   not move after settling (and settling itself fails while asks keep starting). The commit bound is NOT a
 *   reliable detector here (red delta was as low as 17 against 100), and is not tightened because head under
 *   load must not flake.
 * - remove one: the ask delta must be exactly 1; a loop adds dozens.
 */
for (const saved of [[], [guestSearch("a", "engineer"), guestSearch("b", "designer")]]) {
  test(`${saved.length} saved searches: the counts are asked for once each and 10 s idle commits stay under the bound`, { tag: ["@J-ALERTS-49"] }, async ({ page, diagnostics }, info) => {
    const t = await openWithSaved(page, saved);
    const { commits: c0 } = await settle(page, t);
    const settled = t.asks;
    const startedAtSettle = t.started;
    await page.waitForTimeout(10_000);
    const delta = (await commits(page)) - c0;
    info.annotations.push({ type: "measured", description: `n=${saved.length} commitDelta=${delta} (bound ${COMMIT_BOUND}) asks=${settled}->${t.asks} requestDelta=${t.started - startedAtSettle} (bound 0)` });
    expect(delta, `10 s idle commits (bound ${COMMIT_BOUND})`).toBeLessThanOrEqual(COMMIT_BOUND);
    expect(t.asks - settled, `count asks after settling (bound 0; ${settled} -> ${t.asks})`).toBe(0);
    expect(t.started - startedAtSettle, "next-action requests after settling (bound 0)").toBe(0);
    expect(settled, `asks at settle (at most ${strictAsks(saved.length)})`).toBeLessThanOrEqual(strictAsks(saved.length));
    expect(settled, `asks at settle (at least ${saved.length})`).toBeGreaterThanOrEqual(saved.length);
    expect(diagnostics.pageErrors).toEqual([]);
    expect(diagnostics.consoleErrors.filter((e) => /Maximum update depth/.test(e))).toEqual([]);
  });
}

test("removing one of two saved searches asks again once, for the one left", { tag: ["@J-ALERTS-49"] }, async ({ page }, info) => {
  const t = await openWithSaved(page, [guestSearch("a", "engineer"), guestSearch("b", "designer")]);
  await settle(page, t);
  const before = t.asks;
  await page.getByRole("button", { name: "Remove saved search designer" }).click();
  await expect(page.getByTestId("saved-search-item")).toHaveCount(1);
  await settle(page, t);
  info.annotations.push({ type: "measured", description: `removeAskDelta=${t.asks - before} (bound exactly 1)` });
  expect(t.asks - before, "count asks after removing one (exactly 1)").toBe(1);
});

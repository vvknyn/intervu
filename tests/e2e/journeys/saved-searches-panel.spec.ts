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
type Fiber = { flags: number; alternate: unknown; type: unknown; child: Fiber | null; sibling: Fiber | null };
const countCommits = (page: Page) =>
  page.addInitScript(() => {
    const w = window as unknown as { __commits: number; __names: Record<string, number>; __walked: number; __REACT_DEVTOOLS_GLOBAL_HOOK__: unknown };
    w.__commits = 0;
    w.__names = {};
    w.__walked = 0;
    // Which components did work in a commit: sampled (first 300 per read) so a render loop is not slowed by the diagnosis.
    const walk = (f: Fiber | null) => {
      for (; f; f = f.sibling) {
        if (f.flags & 1 && f.alternate && typeof f.type === "function") {
          const n = (f.type as { displayName?: string; name: string }).displayName || f.type.name;
          w.__names[n] = (w.__names[n] ?? 0) + 1;
        }
        walk(f.child);
      }
    };
    w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true,
      renderers: new Map(),
      inject: () => 1,
      onCommitFiberRoot: (_id: number, root: { current: Fiber }) => {
        w.__commits++;
        if (w.__walked++ < 300) walk(root.current);
      },
      onCommitFiberUnmount() {},
      onPostCommitFiberRoot() {},
      checkDCE() {},
    };
  });
/** The commit count, or a throw: a missing or non-numeric count means the hook is not live, and every comparison on it would be vacuous. */
async function commits(page: Page): Promise<number> {
  const n = await page.evaluate(() => (window as unknown as { __commits?: unknown }).__commits);
  if (typeof n !== "number" || !Number.isFinite(n)) throw new Error(`hook not live: the commit counter reads ${String(n)}, not a number`);
  return n;
}
/** Takes and clears the per-component tally of the commits since the last take. */
const takeNames = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __names: Record<string, number>; __walked: number };
    const names = w.__names;
    w.__names = {};
    w.__walked = 0;
    return names;
  });
const topNames = (names: Record<string, number>) =>
  Object.entries(names).sort((x, y) => y[1] - x[1]).slice(0, 5).map(([n, c]) => `${n} x${c}`).join(", ") || "none sampled";
/** Proves the counter is live before any wait trusts it: it is a number and it has risen from the page's first render. */
async function assertHookLive(page: Page) {
  await expect.poll(() => commits(page), { message: "hook not live: no React commit counted since the page rendered", timeout: 10_000 }).toBeGreaterThan(0);
}

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

const sumNames = (ws: Record<string, number>[]) => {
  const out: Record<string, number> = {};
  for (const w of ws) for (const [n, c] of Object.entries(w)) out[n] = (out[n] ?? 0) + c;
  return out;
};
const QUIET_SAMPLES = 4; // 4 x 500 ms = a 2 s window
const SETTLE_BOUND_MS = 40_000;
/**
 * Settled = no React commit and no new next-action request, and none still in flight, for a 2 s window
 * (a cold dev server commits while lazy chunks arrive, and a count reply that lands late re-renders and can
 * start the next ask). A loop never has such a window, so the wait is bounded and fails with what the last
 * window measured instead of running into the test timeout.
 */
async function settle(page: Page, t: ReturnType<typeof trackActions>): Promise<{ commits: number; seconds: number }> {
  await assertHookLive(page);
  const samples: { c: number; started: number }[] = [];
  const windows: Record<string, number>[] = [];
  for (let quiet = 0, start = Date.now(); ; ) {
    const c = await commits(page);
    const prev = samples.at(-1);
    quiet = prev && prev.c === c && prev.started === t.started && t.open === 0 ? quiet + 1 : 0;
    samples.push({ c, started: t.started });
    windows.push(await takeNames(page));
    if (quiet >= QUIET_SAMPLES) return { commits: c, seconds: Math.round((Date.now() - start) / 1000) };
    if (Date.now() - start >= SETTLE_BOUND_MS) {
      const first = samples[Math.max(0, samples.length - 1 - QUIET_SAMPLES)];
      throw new Error(
        `never settled in ${SETTLE_BOUND_MS / 1000} s: last 2 s window had ${c - first.c} commits and ${t.started - first.started} new next-action requests (${t.open} still open); a settled page has 0 / 0 / 0; components that committed in it: ${topNames(sumNames(windows.slice(-QUIET_SAMPLES)))}`,
      );
    }
    await page.waitForTimeout(500);
  }
}

const strictAsks = (n: number) => n * 2;

const guestSearch = (id: string, q: string) => ({ id, name: q, href: `?q=${q}`, createdAt: "2026-10-01T00:00:00.000Z" });

/** A node timer, not page.waitForTimeout: a page starved by a loop does not answer the protocol, and a wait that needs it hangs with it. */
const sleep = (ms: number) => new Promise<"timed out">((r) => setTimeout(() => r("timed out"), ms));

/** The saved list shows on a healthy page; a page starved by a loop never shows it, and the failure carries the last commit count it could still read. */
async function expectListShown(page: Page, n: number, t: ReturnType<typeof trackActions>) {
  let lastRead: number | string = "none";
  let shown: number | string = "unreadable";
  for (const start = Date.now(); ; await sleep(1_000)) {
    const read = await Promise.race([commits(page), sleep(3_000)]);
    if (typeof read === "number") lastRead = read;
    shown = await Promise.race([page.getByTestId("saved-search-item").count(), sleep(3_000).then(() => "unreadable")]);
    if (shown === n) return;
    if (Date.now() - start >= 45_000) {
      throw new Error(`saved list (${n} items) not shown in 45 s (showing ${shown}): last readable commit count ${lastRead}, ${t.started} next-action requests (${t.open} open)`);
    }
  }
}

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
  if (saved.length) await expectListShown(page, saved.length, actions);
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
    test.setTimeout(150_000); // two settle waits of up to 40 s plus the 10 s idle
    const t = await openWithSaved(page, saved);
    const { commits: c0, seconds } = await settle(page, t);
    info.annotations.push({ type: "settled", description: `${seconds} s` });
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
  test.setTimeout(150_000);
  const t = await openWithSaved(page, [guestSearch("a", "engineer"), guestSearch("b", "designer")]);
  info.annotations.push({ type: "settled", description: `${(await settle(page, t)).seconds} s` });
  const before = t.asks;
  await page.getByRole("button", { name: "Remove saved search designer" }).click();
  await expect(page.getByTestId("saved-search-item")).toHaveCount(1);
  info.annotations.push({ type: "settled", description: `${(await settle(page, t)).seconds} s` });
  info.annotations.push({ type: "measured", description: `removeAskDelta=${t.asks - before} (bound exactly 1)` });
  expect(t.asks - before, "count asks after removing one (exactly 1)").toBe(1);
});

import { expect, test } from './fixtures';

/**
 * Effect-deps idle gate: a settled /jobs search page re-renders nothing and sends nothing on its own.
 * An unstable dependency (a fresh array or object each render) shows up as a render loop, "Maximum
 * update depth", or server actions nobody triggered, none of which tsc, unit tests or a screenshot see.
 * Commits are counted through a stub of React's DevTools hook.
 *
 * The window opens after the page has actually gone quiet, not on a fixed clock. A saturated dev
 * server (the full journey run, and only the 390 layout) was still landing the first search and the
 * deferred AuthKit/PostHog mounts after 9s, so a 9s clock counted that startup burst — 6 commits on
 * a lighter pass, 25–39 when the server was busiest. Bisecting 75598f92, #1143, #1147 and #1149 at
 * 390 with a 6× CPU throttle showed 0 commits in the old window at every one of those commits, so
 * none of them added a loop. A real loop never stays quiet, and the bound on the quiet window stays 5.
 */
const QUIET_GAP_MS = 2_000;
const QUIET_POLL_MS = 250;
const SETTLE_DEADLINE_MS = 45_000;
const IDLE_MS = 10_000;
const MAX_COMMITS = 5;

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    test.describe(`idle page at ${viewport.width}`, () => {
        test.use({ viewport });

        test('a settled search page is idle', { tag: ['@J-ALERTS-52'] }, async ({ page }) => {
            test.setTimeout(120_000);
            await page.addInitScript(() => {
                const w = window as unknown as { __commits: number; __REACT_DEVTOOLS_GLOBAL_HOOK__: unknown };
                w.__commits = 0;
                w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
                    supportsFiber: true,
                    renderers: new Map(),
                    inject: () => 1,
                    onCommitFiberRoot: () => { w.__commits += 1; },
                    onCommitFiberUnmount: () => {},
                    onPostCommitFiberRoot: () => {},
                    checkDCE: () => {},
                };
                // Red-plant hook for the gate's own proof: a URL churn that re-runs every effect keyed on the address.
                if (new URLSearchParams(location.search).has('__churn')) {
                    setInterval(() => history.replaceState(null, '', '?q=x' + Date.now()), 50);
                }
            });
            const actions: string[] = [];
            const errors: string[] = [];
            page.on('request', (r) => { if (r.method() === 'POST' && r.headers()['next-action']) actions.push(r.url()); });
            page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
            page.on('pageerror', (e) => errors.push(e.message));

            await page.goto(`/jobs?q=product%20manager${process.env.IDLE_CHURN ? '&__churn=1' : ''}`, { waitUntil: 'domcontentloaded' });
            const commitsNow = () => page.evaluate(() => (window as unknown as { __commits: number }).__commits);
            const settleStarted = Date.now();
            let last = await commitsNow();
            let quietFor = 0;
            while (Date.now() - settleStarted < SETTLE_DEADLINE_MS && quietFor < QUIET_GAP_MS) {
                await page.waitForTimeout(QUIET_POLL_MS);
                const now = await commitsNow();
                if (now === last) quietFor += QUIET_POLL_MS;
                else {
                    quietFor = 0;
                    last = now;
                }
            }
            expect(quietFor, 'the page went quiet (a render loop never does)').toBeGreaterThanOrEqual(QUIET_GAP_MS);
            const before = last;
            const actionsBefore = actions.length;
            await page.waitForTimeout(IDLE_MS);
            const commits = (await commitsNow()) - before;

            expect(commits, 'React commits in 10 s idle').toBeLessThan(MAX_COMMITS);
            expect(actions.length - actionsBefore, 'server actions in 10 s idle').toBe(0);
            expect(errors.filter((e) => /Maximum update depth/.test(e)), 'render loop').toEqual([]);
        });
    });
}

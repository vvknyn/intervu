import { expect, test } from './fixtures';

/**
 * Effect-deps idle gate: a settled /jobs search page re-renders nothing and sends nothing on its own.
 * An unstable dependency (a fresh array or object each render) shows up as a render loop, "Maximum
 * update depth", or server actions nobody triggered, none of which tsc, unit tests or a screenshot see.
 * Commits are counted through a stub of React's DevTools hook.
 */
const SETTLE_MS = 9_000;
const IDLE_MS = 10_000;
const MAX_COMMITS = 5;

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    test.describe(`idle page at ${viewport.width}`, () => {
        test.use({ viewport });

        test('a settled search page is idle', { tag: ['@J-ALERTS-52'] }, async ({ page }) => {
            test.setTimeout(90_000);
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
            await page.waitForTimeout(SETTLE_MS);
            const before = await page.evaluate(() => (window as unknown as { __commits: number }).__commits);
            const actionsBefore = actions.length;
            await page.waitForTimeout(IDLE_MS);
            const commits = (await page.evaluate(() => (window as unknown as { __commits: number }).__commits)) - before;

            expect(commits, 'React commits in 10 s idle').toBeLessThan(MAX_COMMITS);
            expect(actions.length - actionsBefore, 'server actions in 10 s idle').toBe(0);
            expect(errors.filter((e) => /Maximum update depth/.test(e)), 'render loop').toEqual([]);
        });
    });
}

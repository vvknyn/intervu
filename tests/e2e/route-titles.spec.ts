import { test, expect } from '@playwright/test';

/**
 * TEST GROUP: ROUTE-TITLES - every route carries its own honest <title>
 *
 * Class gate for the "homepage title leaks onto other routes" fix
 * (2026-08-26). The homepage title (`LANDING_TITLE`,
 * src/lib/seo/constants.ts) is both the root layout's fallback
 * (`title.default`, src/app/layout.tsx) AND `/jobs`'s explicit
 * `title.absolute` (src/app/jobs/layout.tsx — `/` redirects to `/jobs`,
 * the front door) — any OTHER route that forgets to set its own `title`
 * silently inherits it. Verified leaking on prod: /reset-password,
 * /oauth/authorize, and /watch/anywhere (the last showing /watch/[id]'s
 * title instead of its own).
 *
 * The homepage title is fetched from a live page load rather than
 * hardcoded, so this spec keeps working if `LANDING_TITLE` changes.
 *
 * Add a route to this gate with one entry in PUBLIC_NON_HOME_ROUTES below.
 */
const PUBLIC_NON_HOME_ROUTES = [
    '/reset-password',
    '/oauth/authorize',
    '/watch/anywhere',
    '/contact',
    '/privacy',
    '/terms',
    '/connect',
    '/openclaw',
    '/trends',
];

let homeTitle: string;

test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
        await page.goto('/');
        homeTitle = await page.title();
    } finally {
        await page.close();
    }
});

test.describe('ROUTE-TITLES - every route has its own honest title', () => {
    test('sanity check: the homepage title itself is non-empty', () => {
        expect(homeTitle.trim()).not.toBe('');
    });

    for (const route of PUBLIC_NON_HOME_ROUTES) {
        test(`${route} has a non-empty title that differs from the homepage`, async ({ page }) => {
            await page.goto(route);
            const routeTitle = await page.title();

            expect(routeTitle.trim()).not.toBe('');
            expect(routeTitle).not.toBe(homeTitle);
        });
    }
});

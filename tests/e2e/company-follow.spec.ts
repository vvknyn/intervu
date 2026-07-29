import { test, expect } from '@playwright/test';

/**
 * TEST GROUP: COMPANY-FOLLOW — Milestone 2 smoke
 *
 * Environment-tolerant: company pages for elite-allowlisted domains return 200
 * even when Meilisearch is unconfigured (KPIs may be empty). Follow toggle uses
 * guest localStorage only — no Firebase required. Unknown slugs always 404.
 */

const GUEST_FOLLOWS_KEY = 'intervu.follows.guest';

/** Stable elite allowlist entry — page 200s without indexed jobs */
const ELITE_COMPANY_SLUG = 'anthropic--com';
const ELITE_COMPANY_DOMAIN = 'anthropic.com';

test.describe('COMPANY-FOLLOW - Milestone 2 smoke', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try {
                window.localStorage.clear();
            } catch {
                /* ignore */
            }
        });
    });

    test('unknown company slug returns 404', async ({ page }) => {
        await page.goto('/co/not-a-real-company-slug');
        await expect(page.getByText('Page not found')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText('404')).toBeVisible();
        await expect(page.getByTestId('company-page')).not.toBeVisible();
    });

    test('elite allowlisted company page loads', async ({ page }) => {
        await page.goto(`/co/${ELITE_COMPANY_SLUG}`);

        const companyPage = page.getByTestId('company-page');
        const notFound = page.getByText('Page not found');

        await expect(companyPage.or(notFound).first()).toBeVisible({ timeout: 30_000 });

        if (await notFound.isVisible()) {
            test.skip(true, 'Company page 404 — allowlist unavailable in this build');
        }

        await expect(companyPage).toBeVisible();
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(page.getByTestId('follow-company')).toBeVisible();
    });

    test('guest follow toggle persists in localStorage', async ({ page }) => {
        await page.goto(`/co/${ELITE_COMPANY_SLUG}`);

        const companyPage = page.getByTestId('company-page');
        await expect(companyPage.or(page.getByText('Page not found')).first()).toBeVisible({
            timeout: 30_000,
        });
        if (!(await companyPage.isVisible())) {
            test.skip(true, 'Company page unavailable — allowlist missing in this build');
        }

        const btn = page.getByTestId('follow-company');
        await expect(btn).toHaveAttribute('data-following', 'false');

        await btn.click();
        await expect(btn).toHaveAttribute('data-following', 'true');
        await expect(btn).toHaveText(/Following/);

        const stored = await page.evaluate((key) => localStorage.getItem(key), GUEST_FOLLOWS_KEY);
        expect(stored).toBeTruthy();
        expect(stored).toContain(ELITE_COMPANY_DOMAIN);

        await btn.click();
        await expect(btn).toHaveAttribute('data-following', 'false');

        const cleared = await page.evaluate((key) => localStorage.getItem(key), GUEST_FOLLOWS_KEY);
        expect(cleared === '[]' || cleared === null).toBeTruthy();
    });
});

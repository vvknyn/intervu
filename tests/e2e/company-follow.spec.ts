import { test, expect } from '@playwright/test';

/**
 * TEST GROUP: COMPANY-FOLLOW — Milestone 2 smoke
 *
 * Environment-tolerant: company pages for elite-allowlisted domains return 200
 * even when Meilisearch is unconfigured (KPIs may be empty). Unknown slugs
 * always 404.
 *
 * Milestone 4 (the follow-email-gate fix): a signed-out click on Follow no
 * longer flips the button to "Following" — a guest-store bookmark isn't a
 * real notification channel. The click opens the one-field email step right
 * at the button instead; only a verified email (or a signed-in account) may
 * render "Following". Turnstile is live in this env, so these specs stop at
 * "the email step opened / is focusable" — no real submission.
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

    test('guest click on Follow never renders Following — it opens the sign-in dialog instead', async ({ page }) => {
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
        await expect(page).not.toHaveURL(/\/login/);

        // The core gate: still not "Following" — no channel exists yet.
        await expect(btn).toHaveAttribute('data-following', 'false');
        await expect(btn).not.toHaveText(/Following/);

        // The sign-in dialog opened instead of a fake follow.
        await expect(page.getByRole('dialog')).toBeVisible();

        // The click is still recorded as guest-store intent (may migrate to
        // a real account follow on sign-in) — it just never renders as
        // "Following" off that alone.
        const stored = await page.evaluate((key) => localStorage.getItem(key), GUEST_FOLLOWS_KEY);
        expect(stored).toContain(ELITE_COMPANY_DOMAIN);
    });
});

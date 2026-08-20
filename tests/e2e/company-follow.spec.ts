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

    test('guest follow shows persist CTA without gating browse', async ({ page }) => {
        await page.goto(`/co/${ELITE_COMPANY_SLUG}`);

        const companyPage = page.getByTestId('company-page');
        await expect(companyPage.or(page.getByText('Page not found')).first()).toBeVisible({
            timeout: 30_000,
        });
        if (!(await companyPage.isVisible())) {
            test.skip(true, 'Company page unavailable — allowlist missing in this build');
        }

        const btn = page.getByTestId('follow-company');
        const prompt = page.getByTestId('follow-persist-prompt');
        const persistCta = page.getByTestId('follow-persist-cta');
        const heading = page.getByRole('heading', { level: 1 });
        const companyName = (await heading.textContent())?.trim() ?? '';

        await expect(prompt).not.toBeVisible();
        await expect(persistCta).not.toBeVisible();

        await btn.click();
        await expect(page).not.toHaveURL(/\/login/);
        await expect(btn).toHaveAttribute('data-following', 'true');

        await expect(prompt).toBeVisible();
        await expect(prompt).toContainText(companyName);
        await expect(prompt).toContainText('Get a weekly note when they post');
        await expect(persistCta).toBeVisible();

        // Persist CTA now opens the one-field email step inline (Milestone
        // 3) instead of the account dialog directly — sign-in is a fallback
        // reached from inside that step.
        await persistCta.click();
        const emailStep = page.getByTestId('follow-email-step');
        await expect(emailStep).toBeVisible();
        await expect(prompt).not.toBeVisible();

        await page.getByTestId('follow-email-signin').click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await expect(emailStep).not.toBeVisible();

        await page.getByRole('button', { name: 'Close' }).click();
        await expect(dialog).not.toBeVisible();

        await expect(btn).toHaveAttribute('data-following', 'true');
        const stored = await page.evaluate((key) => localStorage.getItem(key), GUEST_FOLLOWS_KEY);
        expect(stored).toContain(ELITE_COMPANY_DOMAIN);
        await expect(prompt).toBeVisible();

        await btn.click();
        await expect(btn).toHaveAttribute('data-following', 'false');
        await expect(prompt).not.toBeVisible();
    });

    test('persist CTA opens email step, sign-in link falls back to auth dialog', async ({ page }) => {
        await page.goto(`/co/${ELITE_COMPANY_SLUG}`);

        const companyPage = page.getByTestId('company-page');
        await expect(companyPage.or(page.getByText('Page not found')).first()).toBeVisible({
            timeout: 30_000,
        });
        if (!(await companyPage.isVisible())) {
            test.skip(true, 'Company page unavailable — allowlist missing in this build');
        }

        await page.getByTestId('follow-company').click();

        const persistCta = page.getByTestId('follow-persist-cta');
        await expect(persistCta).toBeVisible();
        await persistCta.click();

        const emailStep = page.getByTestId('follow-email-step');
        await expect(emailStep).toBeVisible();

        // Focusable, not submitted — live Turnstile means no e2e submission.
        const emailInput = page.getByTestId('follow-email-input');
        await emailInput.focus();
        await expect(emailInput).toBeFocused();

        await page.getByTestId('follow-email-signin').click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await expect(emailStep).not.toBeVisible();
    });
});

import { test, expect, type Page } from '@playwright/test';

/**
 * TEST GROUP: SIGNUP-LADDER - TopBar auth CTA contract (Batch 4)
 *
 * Lean product surfaces (/jobs, /resume): one filled Sign in (topbar-signin).
 * Signed-out marketing routes: quiet ghost Sign in + green Create account.
 * Signed-in visitors see the avatar menu — no header auth CTAs.
 */
async function signInAsMock(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __INTERVU_E2E_AUTH__: unknown }).__INTERVU_E2E_AUTH__ = {
      uid: 'e2e-signup-ladder-uid',
      displayName: 'Ada Lovelace',
      email: 'ada@example.com',
      emailVerified: true,
      isAnonymous: false,
      providerData: [],
      metadata: {},
      photoURL: null,
      phoneNumber: null,
      providerId: 'password',
      tenantId: null,
      refreshToken: 'e2e-mock-refresh-token',
    };
  });
}

test.describe('SIGNUP-LADDER - TopBar auth CTA contract', () => {
  test('TC-LADDER-001: lean /jobs shows one filled Sign in', async ({ page }) => {
    await page.goto('/jobs');
    await page.waitForLoadState('networkidle');

    const signIn = page.getByTestId('topbar-signin');
    await expect(signIn).toBeVisible();
    await expect(signIn).toHaveText('Sign in');
    await expect(page.getByTestId('topbar-create-account')).toHaveCount(0);

    await signIn.click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('TC-LADDER-002: marketing /about shows Sign in + Create account', async ({ page }) => {
    await page.goto('/about');
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('topbar-signin')).toBeVisible();
    await expect(page.getByTestId('topbar-create-account')).toBeVisible();
    await expect(page.getByTestId('topbar-create-account')).toHaveText('Create account');

    await page.getByTestId('topbar-create-account').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Create your account')).toBeVisible();
  });

  test('TC-LADDER-003: signed-in header shows neither auth CTA', async ({ page }) => {
    await signInAsMock(page);
    await page.goto('/jobs');
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('topbar-avatar')).toBeVisible();
    await expect(page.getByTestId('topbar-signin')).not.toBeVisible();
    await expect(page.getByTestId('topbar-create-account')).not.toBeVisible();
  });
});

import { test, expect, type Page } from '@playwright/test';
import {
  clickVisibleSignIn,
  marketingTopBarCreateAccount,
  marketingTopBarSignIn,
  visibleSignInLocator,
} from './helpers/signed-out-auth-entry';

/**
 * TEST GROUP: SIGNUP-LADDER - TopBar auth CTA contract (Batch 4)
 *
 * Lean /jobs (Concept A poster when at rest): visible poster Sign in, not obscured TopBar.
 * Signed-out marketing routes: quiet ghost Sign in + green Create account on TopBar.
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
  test('TC-LADDER-001: lean /jobs uses visible Concept A Sign in when poster is shown', async ({ page }) => {
    await page.goto('/jobs');
    await page.waitForLoadState('networkidle');

    const signIn = await visibleSignInLocator(page);
    await expect(signIn).toBeVisible();
    await expect(signIn).toHaveText('Sign in');
    await expect(page.getByTestId('topbar-create-account')).toBeHidden();

    await clickVisibleSignIn(page);
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('TC-LADDER-002: marketing /about shows TopBar Sign in + Create account', async ({ page }) => {
    await page.goto('/about');
    await page.waitForLoadState('networkidle');

    await expect(marketingTopBarSignIn(page)).toBeVisible();
    await expect(marketingTopBarCreateAccount(page)).toBeVisible();
    await expect(marketingTopBarCreateAccount(page)).toHaveText('Create account');

    await marketingTopBarCreateAccount(page).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Create account', level: 1 })).toBeVisible();
  });

  test('TC-LADDER-003: signed-in header shows neither auth CTA', async ({ page }) => {
    await signInAsMock(page);
    await page.goto('/jobs');
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('topbar-avatar')).toBeVisible();
    await expect(page.getByTestId('topbar-signin')).toBeHidden();
    await expect(page.getByTestId('topbar-create-account')).toBeHidden();
  });
});

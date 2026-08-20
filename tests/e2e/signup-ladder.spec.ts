import { test, expect, type Page } from '@playwright/test';

/**
 * TEST GROUP: SIGNUP-LADDER - TopBar value-first CTA (wave-2, 2026-08-20 audit)
 *
 * The signed-out header's only CTA used to be a bare "Log in" — an ask with
 * no value attached. It now leads with "Get job alerts"
 * (data-testid="topbar-alerts-cta", inverted-ink primary), demoting "Log in"
 * to a quiet text link (data-testid="topbar-login", unchanged testid so
 * navigation.spec.ts / auth.spec.ts keep passing). Signed-in visitors see
 * neither — the avatar menu replaces both.
 *
 * Signed-in state is faked via the same dev-only `__INTERVU_E2E_AUTH__` hook
 * coin-balance.spec.ts uses (src/lib/firebase/client-auth.ts) — real
 * Firebase never runs in this suite.
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

test.describe('SIGNUP-LADDER - TopBar value-first CTA', () => {
  test('TC-LADDER-001: signed-out header leads with "Get job alerts", demotes "Log in"', async ({ page }) => {
    await page.goto('/jobs');
    await page.waitForLoadState('networkidle');

    const alertsCta = page.getByTestId('topbar-alerts-cta');
    const login = page.getByTestId('topbar-login');
    await expect(alertsCta).toBeVisible();
    await expect(alertsCta).toHaveText('Get job alerts');
    await expect(login).toBeVisible();

    // Opens straight into the signup tab — where the alerts/tracker value
    // line the header just promised is what actually renders.
    await alertsCta.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Create your account')).toBeVisible();
  });

  test('TC-LADDER-002: signed-in header shows neither CTA', async ({ page }) => {
    await signInAsMock(page);
    await page.goto('/jobs');
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('topbar-avatar')).toBeVisible();
    await expect(page.getByTestId('topbar-alerts-cta')).not.toBeVisible();
    await expect(page.getByTestId('topbar-login')).not.toBeVisible();
  });
});

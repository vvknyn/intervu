import { test, expect } from './helpers/auth-gate';

/**
 * TEST GROUP: SETTINGS - Account page tests (lean 3-tab layout)
 *
 * All copy/locator text below matches the current UI as of the 2026-08-27
 * auth/docs redesign. Independent of that redesign, `/settings` is (and
 * was, pre-redesign — see AUTH_GATED_PRODUCT_PREFIXES in
 * lib/auth/product-routes.ts, unchanged by this work) server-gated: a
 * logged-out run of this file redirects every test to the external WorkOS
 * AuthKit hosted login before it ever reaches this page, so the whole
 * suite reads red without credentials. That gate is a pre-existing gap,
 * not something the auth/docs redesign touches or fixes — every test here
 * goes through tests/e2e/helpers/auth-gate.ts, which skips the whole file
 * unless E2E_STORAGE_STATE points at a real signed-in session.
 */

test.describe('SETTINGS - Account Page Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
  });

  test('TC-SETTINGS-001: Account page loads', async ({ page }) => {
    await expect(page).toHaveURL('/settings');
    // PageHeader title is "Settings" as of the 2026-08-27 auth/docs
    // redesign (SettingsContainer.tsx) — was "Account".
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible();
    await expect(page.locator('text=What your agent (and the board) need to know')).toBeVisible();
  });

  test('TC-SETTINGS-002: Settings tabs are visible', async ({ page }) => {
    await expect(page.getByRole('tab', { name: 'Resume' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Preferences' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'API key' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Account' })).toBeVisible();
  });

  test('TC-SETTINGS-003: Resume tab shows resume section', async ({ page }) => {
    await expect(page.locator('text=Your resume')).toBeVisible();
  });

  test('TC-SETTINGS-004: Preferences tab shows job search section', async ({ page }) => {
    await page.getByRole('tab', { name: 'Preferences' }).click();
    await expect(page).toHaveURL('/settings?tab=prefs');
    await expect(page.locator('text=Job search')).toBeVisible();
    await expect(page.locator('text=Standing answers')).toBeVisible();
  });

  test('TC-SETTINGS-005: Account tab shows sign-in section', async ({ page }) => {
    await page.getByRole('tab', { name: 'Account' }).click();
    await expect(page).toHaveURL('/settings?tab=account');
    await expect(page.locator('text=Sign-in')).toBeVisible();
  });

  test('TC-SETTINGS-006: Connected agents quiet link is visible', async ({ page }) => {
    await expect(page.locator('text=Connected agents live on the')).toBeVisible();
    await expect(page.locator('a:has-text("landing page")')).toBeVisible();
  });

  test('TC-SETTINGS-012: Page responsive on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.reload();
    // PageHeader title is "Settings" as of the 2026-08-27 auth/docs
    // redesign (SettingsContainer.tsx) — was "Account".
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Resume' })).toBeVisible();
  });

  test('TC-SETTINGS-013: Guest user sees login prompt on resume tab', async ({ page }) => {
    const loginLink = page.locator('button:has-text("login"), a:has-text("login"), button:has-text("Log in")');
    await expect(loginLink.first()).toBeVisible({ timeout: 5000 });
  });

  test('TC-SETTINGS-015: Back navigation works', async ({ page }) => {
    await expect(page).toHaveURL('/settings');
    await page.goto('/');
    await expect(page).toHaveURL('/jobs');
  });
});

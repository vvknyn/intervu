import { test, expect } from '@playwright/test';

/**
 * TEST GROUP: SETTINGS - Account page tests (lean 3-tab layout)
 */

test.describe('SETTINGS - Account Page Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
  });

  test('TC-SETTINGS-001: Account page loads', async ({ page }) => {
    await expect(page).toHaveURL('/settings');
    await expect(page.locator('h1:has-text("Account")')).toBeVisible();
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
    await expect(page.locator('h1:has-text("Account")')).toBeVisible();
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

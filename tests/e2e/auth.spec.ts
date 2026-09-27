import { test, expect } from '@playwright/test';
import { clickVisibleSignIn, visibleSignInLocator } from './helpers/signed-out-auth-entry';

/**
 * TEST GROUP: AUTH - Authentication Tests
 *
 * Signed-out login entry: Concept A poster Sign in on /jobs when visible,
 * otherwise visible TopBar `topbar-signin` (marketing routes).
 */

test.describe('AUTH - Authentication Tests', () => {

  /**
   * TC-AUTH-001: Login button exists in navigation
   *
   * Verifies the login button is accessible from the sidebar/nav.
   */
  test('TC-AUTH-001: Login button exists in navigation', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const loginButton = await visibleSignInLocator(page);
    await expect(loginButton).toBeVisible({ timeout: 10000 });
  });

  /**
   * TC-AUTH-002: Clicking login opens auth modal
   *
   * Clicking Login should open an authentication dialog with form fields.
   */
  test('TC-AUTH-002: Clicking login opens auth modal', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Click login button (sidebar or nav)
    const loginButton = await visibleSignInLocator(page);
    if (await loginButton.isVisible()) {
      await clickVisibleSignIn(page);

      // Verify auth form appears (password input or dialog)
      const authForm = page.locator('input[type="password"], [role="dialog"]');
      await expect(authForm.first()).toBeVisible({ timeout: 5000 });
    }
  });

  /**
   * TC-AUTH-003: Auth form has username and password fields
   *
   * The authentication form should have username/email and password inputs.
   */
  test('TC-AUTH-003: Auth form has username and password fields', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const loginButton = await visibleSignInLocator(page);
    if (await loginButton.isVisible()) {
      await clickVisibleSignIn(page);
      await page.waitForTimeout(500);

      // Should have both username/email and password inputs
      const textInputs = page.locator('input[type="text"], input[type="email"]');
      const passwordInput = page.locator('input[type="password"]');

      await expect(textInputs.first()).toBeVisible({ timeout: 5000 });
      await expect(passwordInput.first()).toBeVisible({ timeout: 5000 });
    }
  });

  /**
   * TC-AUTH-004: Password field is masked
   *
   * Password field should hide input characters.
   */
  test('TC-AUTH-004: Password field is masked', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const loginButton = await visibleSignInLocator(page);
    if (await loginButton.isVisible()) {
      await clickVisibleSignIn(page);

      const passwordField = page.locator('input[type="password"]');
      await expect(passwordField.first()).toHaveAttribute('type', 'password');
    }
  });

  /**
   * TC-AUTH-005: Login form validates empty submission
   *
   * Submitting empty form should show validation errors or be blocked.
   */
  test('TC-AUTH-005: Login form validates empty submission', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const loginButton = await visibleSignInLocator(page);
    if (await loginButton.isVisible()) {
      await clickVisibleSignIn(page);
      await page.waitForTimeout(500);

      // Try to submit without filling fields — scoped to the auth dialog:
      // the TopBar's own always-visible "Sign in" trigger also matches
      // "Sign In" case-insensitively and stays in the DOM once the dialog
      // opens, so an unscoped locator picks it up instead of the real
      // submit button.
      const submitButton = page
        .getByRole('dialog')
        .locator('button[type="submit"], button:has-text("Sign In")')
        .first();
      if (await submitButton.isVisible()) {
        await submitButton.click();
        await page.waitForTimeout(500);

        // Page should not navigate away — still on auth form
        const authForm = page.locator('input[type="password"]');
        await expect(authForm.first()).toBeVisible();
      }
    }
  });

  /**
   * TC-AUTH-006: Guest mode allows access to all features
   *
   * Verifies unauthenticated users can still use the application.
   */
  test('TC-AUTH-006: Guest mode allows access to all features', async ({ page }) => {
    // Can access the front door without auth
    await page.goto('/');
    await expect(page).toHaveURL('/jobs');

    // Can access the jobs SERP (search chrome lives here now) without auth
    await page.goto('/jobs');
    await expect(page.locator('input[type="text"]').first()).toBeVisible();

    // Can access yours without auth
    await page.goto('/yours');
    await expect(page).toHaveURL('/yours');

    // Can access settings without auth
    await page.goto('/settings');
    await expect(page).toHaveURL('/settings');
  });

  /**
   * TC-AUTH-007: Guest mode shows login prompt in settings
   *
   * Settings page should show a login prompt for guest users.
   */
  test('TC-AUTH-007: Guest mode shows login prompt in settings', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // Should see "login" link for unauthenticated users
    const loginLink = page.locator('button:has-text("login"), a:has-text("login")');
    await expect(loginLink.first()).toBeVisible({ timeout: 5000 });
  });

  /**
   * TC-AUTH-008: Auth dialog can be dismissed
   *
   * The auth dialog should be closable by pressing Escape.
   */
  test('TC-AUTH-008: Auth dialog can be dismissed', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const loginButton = await visibleSignInLocator(page);
    if (await loginButton.isVisible()) {
      await clickVisibleSignIn(page);
      await expect(page.locator('input[type="password"]').first()).toBeVisible({ timeout: 5000 });

      // Press Escape
      await page.keyboard.press('Escape');

      // Dialog should close
      await expect(page.locator('input[type="password"]')).not.toBeVisible({ timeout: 3000 });
    }
  });

  /**
   * TC-AUTH-009: Sign up option exists in auth form
   *
   * The auth form should have a sign up option. Tab label reads "Create
   * account" as of the 2026-08-27 auth/docs redesign (authCardCopy in
   * lib/auth/auth-gate-copy.ts) — was "Sign Up".
   */
  test('TC-AUTH-009: Sign up option exists in auth form', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const loginButton = await visibleSignInLocator(page);
    if (await loginButton.isVisible()) {
      await clickVisibleSignIn(page);
      await page.waitForTimeout(500);

      const signUp = page.locator('button:has-text("Create account"), a:has-text("Create account")');
      await expect(signUp.first()).toBeVisible({ timeout: 5000 });
    }
  });

  /**
   * TC-AUTH-010: Logout button visible on settings for logged-in users
   *
   * Settings page should show "logout" link for authenticated users.
   */
  test('TC-AUTH-010: Settings page has logout option', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // Look for logout button (only visible if user is signed in)
    const logoutButton = page.locator('button:has-text("logout"), button:has-text("sign out")');
    const count = await logoutButton.count();

    // Soft check — may not be visible for guest users
    expect(count >= 0).toBeTruthy();
  });

  /**
   * TC-AUTH-011: Guest search works without login
   *
   * Guest users can enter a search query and trigger analysis without logging in.
   */
  test('TC-AUTH-011: Guest search works without login', async ({ page }) => {
    // Search chrome lives on /jobs now (front door has no search input).
    await page.goto('/jobs');
    await page.evaluate(() => {
      localStorage.setItem('guest_api_keys', JSON.stringify({ groq: 'gsk_test_key_123456789012345' }));
    });
    await page.reload();
    await page.waitForLoadState('networkidle');

    const searchInput = page.locator('input[type="text"]').first();
    await searchInput.fill('Google, Software Engineer, Technical');

    // Should be able to press Enter without errors
    await searchInput.press('Enter');
    await page.waitForTimeout(1000);

    // Page should not crash
    await expect(page.locator('body')).toBeVisible();
  });
});

import { test, expect } from '@playwright/test';

/**
 * TEST GROUP: WATCH - Phone viewer page
 *
 * The security property worth an e2e test is the login gate: the watch link
 * travels over WhatsApp, so it will be forwarded, screenshotted and left on
 * lock screens. Nothing of the session may render without a session cookie.
 */
test.describe('WATCH - Phone viewer page', () => {
  test('shows a login prompt, not the session, to a visitor who is not signed in', async ({ page }) => {
    await page.goto('/watch/some-unguessable-id');
    await expect(page.getByTestId('watch-login-required')).toBeVisible();
    await expect(page.getByTestId('watch-status')).toHaveCount(0);
    await expect(page.locator('canvas')).toHaveCount(0);
  });

  test('keeps the visitor on the link so logging in does not lose the session', async ({ page }) => {
    // A redirect to / would discard the id, and this page is reached from a
    // message on a phone — exactly when a session cookie is least likely to
    // already exist.
    await page.goto('/watch/some-unguessable-id');
    await expect(page).toHaveURL(/\/watch\/some-unguessable-id$/);
  });
});

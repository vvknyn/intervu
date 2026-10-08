import { test, expect } from '@playwright/test';

/**
 * Touch-target contract — testids wired for signed-out upload and import use-model link.
 */
test.describe('RESUME-TOUCH - résumé control testids', () => {
  test('RESUME-TOUCH-001: signed-out empty state exposes upload control', async ({ page }) => {
    await page.goto('/resume');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('resume-signed-out-upload')).toBeVisible();
    await expect(page.getByTestId('resume-signed-out-upload')).toHaveText(/Upload résumé/i);
  });

  test('RESUME-TOUCH-002: import modal exposes the use-model secondary control', async ({ page }) => {
    await page.goto('/resume');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('resume-signed-out-upload').click();
    await expect(page.getByTestId('resume-import-use-model')).toBeVisible();
    await expect(page.getByTestId('resume-import-parse-primary')).toBeVisible();
  });
});

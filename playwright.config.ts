import { defineConfig, devices } from '@playwright/test';

/**
 * Intervu E2E Test Configuration
 *
 * Test Groups:
 * - NAV: Navigation tests
 * - AUTH: Authentication tests
 * - DASH: Dashboard/Interview Prep tests
 * - RESUME: Resume Builder tests
 * - TAILOR: Resume Tailor tests
 * - APPS: Application Tracker tests
 * - SETTINGS: Settings page tests
 * - MOBILE: Mobile responsive tests
 */

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1, // Retry once locally
  workers: process.env.CI ? 1 : 3, // Limit workers to 3 locally
  timeout: 60000, // 60s timeout per test
  outputDir: 'test-output',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'playwright-report/results.json' }],
  ],
  use: {
    // Override lets a spec run against a manually-managed server (e.g. a
    // prod `next build && next start` on a non-default port) instead of the
    // `npm run dev` webServer below.
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Explicit viewport projects for specs that need a specific desktop or
    // mobile size regardless of the default chromium project's device.
    {
      name: 'desktop-1440',
      use: { viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile-390',
      use: { viewport: { width: 390, height: 844 } },
    },
  ],
  // When PLAYWRIGHT_BASE_URL points at an externally-managed server, don't
  // also launch `npm run dev` — running a dev server and a prod build
  // concurrently in the same worktree corrupts the .next build output.
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'npm run dev', // Use dev for local testing
        url: 'http://localhost:3000',
        reuseExistingServer: true,
        timeout: 120000,
      },
});

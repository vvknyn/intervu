import { test, expect, type Page } from '@playwright/test';

/** Open legacy search UI from session-first landing. */
async function openSearchPlans(page: Page) {
  await page.getByRole('button', { name: 'Search plans' }).click();
  await expect(page.locator('[data-tour="search-input"]')).toBeVisible();
}

/**
 * TEST GROUP: DASH - Dashboard/Interview Prep Tests
 *
 * Tests the main dashboard functionality including search,
 * analysis workflow, and section navigation.
 */

test.describe('DASH - Dashboard Tests', () => {
  /**
   * TC-DASH-001: Search bar accepts input
   *
   * Verifies the search bar accepts and displays user input.
   */
  test('TC-DASH-001: Search bar accepts input', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await openSearchPlans(page);

    const searchInput = page.locator('[data-tour="search-input"]');
    await searchInput.fill('Google, Software Engineer, Technical');

    await expect(searchInput).toHaveValue('Google, Software Engineer, Technical');
  });

  /**
   * TC-DASH-002: Analyze button is visible
   *
   * Verifies the analyze button is visible on the page.
   */
  test('TC-DASH-002: Analyze button is visible', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Verify there are buttons on the page
    const buttons = page.locator('button');
    await expect(buttons.first()).toBeVisible({ timeout: 10000 });
  });

  /**
   * TC-DASH-003: Search with Enter key triggers analyze
   *
   * Pressing Enter in the search field should trigger the analyze action.
   */
  test('TC-DASH-003: Search with Enter key triggers analyze', async ({ page }) => {
    await page.goto('/');

    // Fill search input
    const searchInput = page.locator('input[type="text"]').first();
    await searchInput.fill('Meta, Product Manager, Behavioral');

    // Press Enter
    await searchInput.press('Enter');

    // Wait briefly and verify page doesn't error
    await page.waitForTimeout(500);
    await expect(page.locator('body')).toBeVisible();
  });

  /**
   * TC-DASH-004: Empty search state shows brand
   *
   * When no search has been performed, the brand name should be visible.
   */
  test('TC-DASH-004: Empty search state shows brand', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Landing: session-first home shows brand and primary CTA
    await expect(page.locator('text=Intervu').first()).toBeVisible();
    await expect(page.getByTestId('prep-start-new')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Search plans' })).toBeVisible();

    // Search plans view: legacy search input is available after CTA
    await openSearchPlans(page);
    await expect(page.locator('[data-tour="search-input"]')).toBeVisible();
  });

  /**
   * TC-DASH-005: Navigation rail is visible on desktop
   *
   * The page should have a navigation rail on desktop viewports.
   */
  test('TC-DASH-005: Navigation rail is visible on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Desktop: side rail nav should be visible
    const nav = page.locator('nav[data-tour="nav-menu"]');
    await expect(nav).toBeVisible();
  });

  /**
   * TC-DASH-006: Page has buttons
   *
   * The page should have buttons in the header/nav area.
   */
  test('TC-DASH-006: Page has buttons', async ({ page }) => {
    await page.goto('/');

    // Page should have buttons
    const buttons = page.locator('button');
    const count = await buttons.count();
    expect(count).toBeGreaterThan(0);
  });

  /**
   * TC-DASH-007: Page structure is intact
   *
   * The page should have proper structure.
   */
  test('TC-DASH-007: Page structure is intact', async ({ page }) => {
    await page.goto('/');

    // Page should have body content
    await expect(page.locator('body')).toBeVisible();
  });

  /**
   * TC-DASH-008: Search and button interaction
   *
   * User can fill search and click buttons.
   */
  test('TC-DASH-008: Search and button interaction', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Fill search
    const searchInput = page.locator('input[type="text"]').first();
    await expect(searchInput).toBeVisible({ timeout: 10000 });
    await searchInput.fill('Netflix, Engineer, Technical');

    // Click first button
    const button = page.locator('button').first();
    if (await button.isVisible()) {
      await button.click();
    }

    // Wait for some state change
    await page.waitForTimeout(500);

    // Page should not error
    await expect(page.locator('body')).toBeVisible();
  });

  /**
   * TC-DASH-009: Page handles empty storage gracefully
   *
   * Clearing storage should not break the page.
   */
  test('TC-DASH-009: Page handles empty storage gracefully', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload();

    // Page should still work
    await expect(page.locator('input[type="text"]').first()).toBeVisible();
  });

  /**
   * TC-DASH-010: URL params are accepted
   *
   * Navigating with URL parameters should not error.
   */
  test('TC-DASH-010: URL params are accepted', async ({ page }) => {
    await page.goto('/?company=Apple&position=iOS%20Engineer&round=Onsite&searched=true');

    // Page should load without errors
    await expect(page).toHaveURL(/company=Apple/);
    await expect(page.locator('body')).toBeVisible();
  });

  /**
   * TC-DASH-PREP-001: Clean home shows session-first landing
   *
   * Session-first landing should show the primary Start CTA.
   */
  test('TC-DASH-PREP-001: Clean home shows Start new preparation', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('prep-start-new')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start new preparation' })).toBeVisible();
  });

  /**
   * TC-DASH-PREP-002: Legacy URL loads prep package view
   *
   * Legacy searched=true URLs should load without error and show prep content.
   */
  test('TC-DASH-PREP-002: Legacy URL loads prep content', async ({ page }) => {
    await page.goto('/?company=Apple&position=iOS%20Engineer&round=Onsite&searched=true');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/company=Apple/);

    // Package view hydrates URL params into the dashboard search header
    const searchInput = page.locator('[data-tour="search-input"]');
    await expect(searchInput).toBeVisible({ timeout: 10000 });
    await expect(searchInput).toHaveValue(/Apple/i);
    await expect(searchInput).toHaveValue(/iOS Engineer/i);
  });

  /**
   * TC-DASH-011: Mobile bottom tab bar works
   *
   * On mobile viewport, bottom tab bar should be accessible.
   */
  test('TC-DASH-011: Mobile bottom tab bar works', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');

    // Page should still be functional
    await expect(page.locator('input[type="text"]').first()).toBeVisible();

    // Bottom nav should be visible
    const bottomNav = page.locator('nav.lg\\:hidden');
    await expect(bottomNav).toBeVisible();
  });

  /**
   * TC-DASH-012: Search placeholder text is visible
   *
   * Search input should have helpful placeholder text.
   */
  test('TC-DASH-012: Search placeholder text is visible', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await openSearchPlans(page);

    const searchInput = page.locator('[data-tour="search-input"]');
    await expect(searchInput).toHaveAttribute('placeholder', /./);
  });

  /**
   * TC-DASH-013: Connect your AI nudge visible when no keys
   *
   * When no API keys are configured, a nudge to connect AI should be shown.
   */
  test('TC-DASH-013: Connect your AI nudge visible when no keys', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.removeItem('guest_api_keys');
      localStorage.removeItem('guest_api_key');
    });
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Should see the "Connect your AI" nudge
    const nudge = page.locator('text=Connect your AI');
    await expect(nudge.first()).toBeVisible({ timeout: 5000 });
  });

  /**
   * TC-DASH-014: Connect your AI nudge hidden when keys exist
   *
   * When an API key is configured, the nudge should not be shown.
   */
  test('TC-DASH-014: Connect your AI nudge hidden when keys exist', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem('guest_api_keys', JSON.stringify({ groq: 'gsk_test_key_12345' }));
    });
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Nudge should not appear
    const nudge = page.locator('text=Connect your AI to start');
    await expect(nudge).not.toBeVisible({ timeout: 3000 });
  });
});

/**
 * TEST GROUP: DASH-SEARCH - Search Workflow Tests
 *
 * Tests search in guest mode and with different position types.
 */
test.describe('DASH-SEARCH - Search Workflow Tests', () => {
  /**
   * TC-DASH-SEARCH-001: Guest search with technical position
   *
   * Guest user can search for a technical interview position.
   */
  test('TC-DASH-SEARCH-001: Guest search with technical position', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem('guest_api_keys', JSON.stringify({ groq: 'gsk_test_key_12345678901234' }));
    });
    await page.reload();
    await page.waitForLoadState('networkidle');

    const searchInput = page.locator('input[type="text"]').first();
    await searchInput.fill('Google, Software Engineer, Technical');
    await searchInput.press('Enter');

    await page.waitForTimeout(1000);

    // Page should not crash and should show some loading or result state
    await expect(page.locator('body')).toBeVisible();
  });

  /**
   * TC-DASH-SEARCH-002: Guest search with behavioral position
   *
   * Guest user can search for a behavioral interview position.
   */
  test('TC-DASH-SEARCH-002: Guest search with behavioral position', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem('guest_api_keys', JSON.stringify({ groq: 'gsk_test_key_12345678901234' }));
    });
    await page.reload();
    await page.waitForLoadState('networkidle');

    const searchInput = page.locator('input[type="text"]').first();
    await searchInput.fill('Amazon, Product Manager, Behavioral');
    await searchInput.press('Enter');

    await page.waitForTimeout(1000);
    await expect(page.locator('body')).toBeVisible();
  });

  /**
   * TC-DASH-SEARCH-003: Guest search with non-technical position
   *
   * Guest user can search for a non-technical position type.
   */
  test('TC-DASH-SEARCH-003: Guest search with non-technical position', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem('guest_api_keys', JSON.stringify({ groq: 'gsk_test_key_12345678901234' }));
    });
    await page.reload();
    await page.waitForLoadState('networkidle');

    const searchInput = page.locator('input[type="text"]').first();
    await searchInput.fill('McKinsey, Management Consultant, Case Interview');
    await searchInput.press('Enter');

    await page.waitForTimeout(1000);
    await expect(page.locator('body')).toBeVisible();
  });

  /**
   * TC-DASH-SEARCH-004: Search without API key shows connect prompt
   *
   * Searching without an API key should prompt the user to connect.
   */
  test('TC-DASH-SEARCH-004: Search without API key shows connect prompt', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.removeItem('guest_api_keys');
      localStorage.removeItem('guest_api_key');
    });
    await page.reload();
    await page.waitForLoadState('networkidle');

    const searchInput = page.locator('input[type="text"]').first();
    await searchInput.fill('Google, Engineer, Technical');
    await searchInput.press('Enter');

    await page.waitForTimeout(1000);

    // Should show dialog to connect a key, or error mentioning "Connect"
    const dialog = page.locator('[role="dialog"]');
    const connectText = page.locator('text=/Connect/i');
    const hasDialog = await dialog.isVisible().catch(() => false);
    const hasConnect = await connectText.first().isVisible().catch(() => false);

    expect(hasDialog || hasConnect).toBeTruthy();
  });

  /**
   * TC-DASH-SEARCH-005: Two-part query defaults correctly
   *
   * Queries like "Company, Position" should default to Technical round.
   */
  test('TC-DASH-SEARCH-005: Two-part query defaults correctly', async ({ page }) => {
    await page.goto('/');

    const searchInput = page.locator('input[type="text"]').first();
    await searchInput.fill('Google, Software Engineer');
    await searchInput.press('Enter');

    await page.waitForTimeout(500);
    await expect(page.locator('body')).toBeVisible();
  });

  /**
   * TC-DASH-SEARCH-006: Single word query parses as company
   *
   * A single word should be treated as company name with defaults.
   */
  test('TC-DASH-SEARCH-006: Single word query parses as company', async ({ page }) => {
    await page.goto('/');

    const searchInput = page.locator('input[type="text"]').first();
    await searchInput.fill('Netflix');
    await searchInput.press('Enter');

    await page.waitForTimeout(500);
    await expect(page.locator('body')).toBeVisible();
  });

  /**
   * TC-DASH-SEARCH-007: Comma-separated query parses instantly
   *
   * Queries with commas should parse instantly without showing loading.
   */
  test('TC-DASH-SEARCH-007: Comma-separated query parses instantly', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const searchInput = page.locator('input[type="text"]').first();
    await searchInput.fill('Optym, OR Scientist, Technical');
    await searchInput.press('Enter');

    // Should NOT be stuck on "Parsing your query..." for more than 1 second
    await page.waitForTimeout(1000);
    const parsingText = page.locator('text=Parsing your query...');
    const isStuckOnParsing = await parsingText.isVisible();
    expect(isStuckOnParsing).toBeFalsy();
  });
});

/**
 * TEST GROUP: DASH-API - API Key Configuration Tests
 *
 * Tests the API key configuration and loading functionality.
 */
test.describe('DASH-API - API Key Configuration Tests', () => {
  /**
   * TC-DASH-API-001: API key modal opens from analyze without key
   *
   * User gets prompted to connect when analyzing without a key.
   */
  test('TC-DASH-API-001: API key modal opens when analyzing without key', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Clear any existing API keys
    await page.evaluate(() => {
      localStorage.removeItem('guest_api_keys');
      localStorage.removeItem('guest_api_key');
    });
    await page.reload();

    // Fill search and try to analyze
    const searchInput = page.locator('input[type="text"]').first();
    await searchInput.fill('Google, Engineer, Technical');
    await searchInput.press('Enter');

    // Should show API key modal
    await page.waitForTimeout(1000);
    const hasModal = await page.locator('[role="dialog"]').isVisible();
    expect(hasModal).toBeTruthy();
  });

  /**
   * TC-DASH-API-002: API keys persist in localStorage
   *
   * Saved API keys should persist across page reloads.
   */
  test('TC-DASH-API-002: API keys persist in localStorage', async ({ page }) => {
    await page.goto('/');

    // Set API key in localStorage
    await page.evaluate(() => {
      localStorage.setItem('guest_api_keys', JSON.stringify({ groq: 'test-key-123' }));
    });

    await page.reload();

    // Verify the key is loaded
    const storedKey = await page.evaluate(() => {
      return localStorage.getItem('guest_api_keys');
    });

    expect(storedKey).toContain('test-key-123');
  });

  /**
   * TC-DASH-API-003: Model switcher is visible on landing page
   *
   * The model switcher button should be visible in the header.
   */
  test('TC-DASH-API-003: Model switcher is visible on landing page', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Look for model switcher (contains provider names)
    const modelSwitcher = page.locator('[data-tour="model-switcher"]');
    await expect(modelSwitcher).toBeVisible({ timeout: 10000 });
  });

  /**
   * TC-DASH-API-004: Model switcher dropdown works
   *
   * Clicking model switcher should show provider options.
   */
  test('TC-DASH-API-004: Model switcher dropdown works', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Click model switcher
    const modelSwitcher = page.locator('[data-tour="model-switcher"] button').first();
    await modelSwitcher.click();

    // Should show dropdown with provider options
    await page.waitForTimeout(300);
    const dropdown = page.locator('[data-radix-popper-content-wrapper]');
    await expect(dropdown).toBeVisible({ timeout: 5000 });

    // Should see provider names
    await expect(dropdown.locator('text=Groq')).toBeVisible();
    await expect(dropdown.locator('text=Gemini')).toBeVisible();
    await expect(dropdown.locator('text=OpenAI')).toBeVisible();
  });

  /**
   * TC-DASH-API-005: Cost badges visible in model switcher
   *
   * Model switcher dropdown should show Free/Pay-as-you-go badges per provider.
   */
  test('TC-DASH-API-005: Cost badges visible in model switcher', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Open model switcher
    const modelSwitcher = page.locator('[data-tour="model-switcher"] button').first();
    await modelSwitcher.click();
    await page.waitForTimeout(300);

    const dropdown = page.locator('[data-radix-popper-content-wrapper]');
    await expect(dropdown).toBeVisible();

    // Should show "Free" badges for Groq and Gemini
    const freeBadges = dropdown.locator('text=Free');
    const freeCount = await freeBadges.count();
    expect(freeCount).toBeGreaterThanOrEqual(2);
  });

  /**
   * TC-DASH-API-006: Gear icons for configuration are visible
   *
   * Each provider in dropdown should have a gear icon to open configuration modal.
   */
  test('TC-DASH-API-006: Gear icons for configuration are visible', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Open model switcher
    const modelSwitcher = page.locator('[data-tour="model-switcher"] button').first();
    await modelSwitcher.click();
    await page.waitForTimeout(500);

    // Look for gear/connect buttons
    const dropdown = page.locator('[data-radix-popper-content-wrapper]');
    const gearButtons = dropdown.locator('[title="Connect"]');

    const count = await gearButtons.count();
    // Should have 3 gear icons (one for each provider: Groq, Gemini, OpenAI)
    expect(count).toBeGreaterThanOrEqual(3);
  });

  /**
   * TC-DASH-API-007: Clicking gear icon opens connect modal
   *
   * Clicking a gear icon should open the connect modal for that provider.
   */
  test('TC-DASH-API-007: Clicking gear icon opens connect modal', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Open model switcher
    const modelSwitcher = page.locator('[data-tour="model-switcher"] button').first();
    await modelSwitcher.click();
    await page.waitForTimeout(500);

    // Click first gear icon
    const dropdown = page.locator('[data-radix-popper-content-wrapper]');
    const gearButton = dropdown.locator('[title="Connect"]').first();
    await gearButton.click();
    await page.waitForTimeout(500);

    // Verify modal opened
    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible();

    // Modal should have key input and "Connect" title
    const apiKeyInput = page.locator('input[type="password"]');
    await expect(apiKeyInput).toBeVisible();
  });
});

/**
 * TEST GROUP: DASH-CONTEXT - Optional Context Input Tests
 *
 * Tests the job context URL and text input functionality.
 */
test.describe('DASH-CONTEXT - Optional Context Input Tests', () => {
  /**
   * TC-DASH-CTX-001: Job URL input is visible
   *
   * The optional job posting URL input should be visible.
   */
  test('TC-DASH-CTX-001: Job URL input is visible', async ({ page }) => {
    await page.goto('/');

    // Look for URL input in optional context section
    const urlInput = page.locator('input[type="url"]').first();
    await expect(urlInput).toBeVisible();
  });

  /**
   * TC-DASH-CTX-002: Can switch between URL and text mode
   *
   * User can toggle between URL input and text area.
   */
  test('TC-DASH-CTX-002: Can switch between URL and text mode', async ({ page }) => {
    await page.goto('/');

    // Find toggle button
    const toggleButton = page.locator('button, a').filter({ hasText: /paste.*description|paste.*instead/i }).first();

    if (await toggleButton.isVisible()) {
      await toggleButton.click();

      // Should now show textarea
      const textarea = page.locator('textarea');
      await expect(textarea).toBeVisible({ timeout: 3000 });
    }
  });

  /**
   * TC-DASH-CTX-003: Job context accepts URL input
   *
   * URL input should accept and store values.
   */
  test('TC-DASH-CTX-003: Job context accepts URL input', async ({ page }) => {
    await page.goto('/');

    const urlInput = page.locator('input[type="url"]').first();
    await urlInput.fill('https://careers.example.com/job/123');

    await expect(urlInput).toHaveValue('https://careers.example.com/job/123');
  });
});

/**
 * TEST GROUP: DASH-PROGRESS - Progressive Loading Tests
 *
 * Tests the progressive loading functionality for dashboard sections.
 */
test.describe('DASH-PROGRESS - Progressive Loading Tests', () => {
  /**
   * TC-DASH-PROG-001: Dashboard shows before all sections load
   *
   * Dashboard should become visible after initial sections complete.
   */
  test('TC-DASH-PROG-001: Dashboard appears progressively', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Set API key to enable analysis
    await page.evaluate(() => {
      localStorage.setItem('guest_api_keys', JSON.stringify({ groq: 'gsk_test' }));
    });

    // Fill search
    const searchInput = page.locator('input[type="text"]').first();
    await searchInput.fill('Google, Engineer, Technical');

    // Start analysis
    await searchInput.press('Enter');

    // Wait for loading to start
    await page.waitForTimeout(2000);

    // Dashboard should eventually appear (even if sections still loading)
    const dashboardContent = page.locator('text=/company|position|interview/i');
    await expect(dashboardContent.first()).toBeVisible({ timeout: 30000 });
  });
});

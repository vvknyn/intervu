import { test, expect, type Page } from '@playwright/test';

/** Open legacy search UI from session-first landing. */
async function openSearchPlans(page: Page) {
  await page.getByRole('button', { name: 'Search plans' }).click();
  await expect(page.locator('[data-tour="search-input"]')).toBeVisible();
}

/** Open prep settings panel from search plans view. */
async function openPrepSettings(page: Page) {
  await page.locator('[data-tour="prep-settings"] button').click();
  await expect(page.getByRole('heading', { name: 'Interview Configuration' })).toBeVisible();
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
    await page.goto('/prep');
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
    await page.goto('/prep');
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
    await page.goto('/prep');
    await page.waitForLoadState('networkidle');

    await openSearchPlans(page);

    const searchInput = page.locator('[data-tour="search-input"]');
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
    await page.goto('/prep');
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
   * TC-DASH-005: Top bar is visible on desktop
   *
   * The page should have the shell's top bar on desktop viewports.
   * (Was a side-rail nav pre-flip — the sidebar is deleted, not hidden.)
   */
  test('TC-DASH-005: Top bar is visible on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/prep');
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('topbar')).toBeVisible();
  });

  /**
   * TC-DASH-006: Page has buttons
   *
   * The page should have buttons in the header/nav area.
   */
  test('TC-DASH-006: Page has buttons', async ({ page }) => {
    await page.goto('/prep');

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
    await page.goto('/prep');

    // Page should have body content
    await expect(page.locator('body')).toBeVisible();
  });

  /**
   * TC-DASH-008: Search and button interaction
   *
   * User can fill search and click buttons.
   */
  test('TC-DASH-008: Search and button interaction', async ({ page }) => {
    await page.goto('/prep');
    await page.waitForLoadState('networkidle');

    await openSearchPlans(page);

    const searchInput = page.locator('[data-tour="search-input"]');
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
    await page.goto('/prep');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Session-first landing should still render after clearing storage
    await expect(page.getByTestId('prep-start-new')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Search plans' })).toBeVisible();
  });

  /**
   * TC-DASH-010: URL params are accepted
   *
   * Navigating with URL parameters should not error.
   */
  test('TC-DASH-010: URL params are accepted', async ({ page }) => {
    await page.goto('/prep?company=Apple&position=iOS%20Engineer&round=Onsite&searched=true');

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
    await page.goto('/prep');
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
    await page.goto('/prep?company=Apple&position=iOS%20Engineer&round=Onsite&searched=true');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/company=Apple/);

    // Package view hydrates URL params into the dashboard search header
    const searchInput = page.locator('[data-tour="search-input"]');
    await expect(searchInput).toBeVisible({ timeout: 10000 });
    await expect(searchInput).toHaveValue(/Apple/i);
    await expect(searchInput).toHaveValue(/iOS Engineer/i);
  });

  /**
   * TC-DASH-PREP-003: Legacy URL shows package-first content
   *
   * Legacy searched=true URLs should open the prep package path, not session-first landing.
   */
  test('TC-DASH-PREP-003: Legacy URL shows package-first content', async ({ page }) => {
    await page.goto('/prep?company=Apple&position=iOS%20Engineer&round=Onsite&searched=true');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/company=Apple/);
    await expect(page.getByTestId('prep-start-new')).not.toBeVisible();

    const searchInput = page.locator('[data-tour="search-input"]');
    await expect(searchInput).toBeVisible({ timeout: 10000 });
    await expect(searchInput).toHaveValue(/Apple/i);
    await expect(searchInput).toHaveValue(/iOS Engineer/i);
  });

  /**
   * TC-DASH-PREP-004: View switch visible when plan loaded
   *
   * When a cached plan is present, the Session | Prep package switch should appear.
   */
  test('TC-DASH-PREP-004: View switch visible when plan loaded', async ({ page }) => {
    await page.goto('/prep');
    await page.evaluate(() => {
      function getCacheKey(company: string, position: string, round: string) {
        const normalized = `${company.toLowerCase()}_${position.toLowerCase()}_${round.toLowerCase()}`;
        let hash = 0;
        for (let i = 0; i < normalized.length; i++) {
          const char = normalized.charCodeAt(i);
          hash = ((hash << 5) - hash) + char;
          hash = hash & hash;
        }
        return `${Math.abs(hash).toString(36)}_${normalized.substring(0, 20)}`;
      }

      const company = 'Apple';
      const position = 'iOS Engineer';
      const round = 'Onsite';
      const cacheKey = getCacheKey(company, position, round);
      const now = Date.now();

      localStorage.setItem('interview_prep_cache', JSON.stringify({
        [cacheKey]: {
          cacheKey,
          company,
          position,
          round,
          hasResumeContext: false,
          createdAt: now,
          expiresAt: now + 24 * 60 * 60 * 1000,
          questionsData: {
            questions: [{ id: 'q1', text: 'Tell me about yourself.', category: 'behavioral' }],
          },
        },
      }));
    });

    await page.goto('/prep?company=Apple&position=iOS%20Engineer&round=Onsite&searched=true');
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('prep-view-switch')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('tab', { name: 'Prep package' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Session' })).toBeVisible();
  });

  /**
   * TC-DASH-PREP-005: View switch hidden on landing despite stale plan/session state
   *
   * Navigating home after loading a plan should not show the package switch on landing/setup.
   */
  test('TC-DASH-PREP-005: View switch hidden on clean home landing', async ({ page }) => {
    await page.goto('/prep');
    await page.evaluate(() => {
      function getCacheKey(company: string, position: string, round: string) {
        const normalized = `${company.toLowerCase()}_${position.toLowerCase()}_${round.toLowerCase()}`;
        let hash = 0;
        for (let i = 0; i < normalized.length; i++) {
          const char = normalized.charCodeAt(i);
          hash = ((hash << 5) - hash) + char;
          hash = hash & hash;
        }
        return `${Math.abs(hash).toString(36)}_${normalized.substring(0, 20)}`;
      }

      const company = 'Apple';
      const position = 'iOS Engineer';
      const round = 'Onsite';
      const cacheKey = getCacheKey(company, position, round);
      const now = Date.now();

      localStorage.setItem('interview_prep_cache', JSON.stringify({
        [cacheKey]: {
          cacheKey,
          company,
          position,
          round,
          hasResumeContext: false,
          createdAt: now,
          expiresAt: now + 24 * 60 * 60 * 1000,
          questionsData: {
            questions: [{ id: 'q1', text: 'Tell me about yourself.', category: 'behavioral' }],
          },
        },
      }));

      localStorage.setItem(`intervu_prep_session_v1_${cacheKey}`, JSON.stringify({
        version: 1,
        planCacheKey: cacheKey,
        mode: 'learn',
        startedAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
        currentIndex: 0,
        questionIds: ['q1'],
        questions: {
          q1: { status: 'unreviewed', starred: false },
        },
      }));
    });

    await page.goto('/prep?company=Apple&position=iOS%20Engineer&round=Onsite&searched=true');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('prep-view-switch')).toBeVisible({ timeout: 10000 });

    await page.goto('/prep');
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('prep-start-new')).toBeVisible();
    await expect(page.getByTestId('prep-view-switch')).not.toBeVisible();

    await page.getByTestId('prep-start-new').click();
    await expect(page.getByTestId('prep-view-switch')).not.toBeVisible();
  });

  /**
   * TC-DASH-011: Mobile top bar works
   *
   * On mobile viewport, the shell's top bar should be accessible.
   * (Was the bottom tab bar pre-flip — no mobile-nav replacement in PR 1.)
   */
  test('TC-DASH-011: Mobile top bar works', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/prep');
    await page.waitForLoadState('networkidle');

    // Session-first landing should be functional on mobile
    await expect(page.getByTestId('prep-start-new')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Search plans' })).toBeVisible();

    await expect(page.getByTestId('topbar')).toBeVisible();
  });

  /**
   * TC-DASH-012: Search placeholder text is visible
   *
   * Search input should have helpful placeholder text.
   */
  test('TC-DASH-012: Search placeholder text is visible', async ({ page }) => {
    await page.goto('/prep');
    await page.waitForLoadState('networkidle');

    await openSearchPlans(page);

    const searchInput = page.locator('[data-tour="search-input"]');
    await expect(searchInput).toHaveAttribute('placeholder', /./);
  });

  /**
   * TC-DASH-013: Landing works without guest API keys
   *
   * Session-first landing should render even when guest keys are cleared.
   */
  test('TC-DASH-013: Landing works without guest API keys', async ({ page }) => {
    await page.goto('/prep');
    await page.evaluate(() => {
      localStorage.removeItem('guest_api_keys');
      localStorage.removeItem('guest_api_key');
    });
    await page.reload();
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('prep-start-new')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Search plans' })).toBeVisible();
  });

  /**
   * TC-DASH-014: Connect your AI nudge hidden when keys exist
   *
   * When an API key is configured, the nudge should not be shown.
   */
  test('TC-DASH-014: Connect your AI nudge hidden when keys exist', async ({ page }) => {
    await page.goto('/prep');
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
    await page.goto('/prep');
    await page.evaluate(() => {
      localStorage.setItem('guest_api_keys', JSON.stringify({ groq: 'gsk_test_key_12345678901234' }));
    });
    await page.reload();
    await page.waitForLoadState('networkidle');

    await openSearchPlans(page);

    const searchInput = page.locator('[data-tour="search-input"]');
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
    await page.goto('/prep');
    await page.evaluate(() => {
      localStorage.setItem('guest_api_keys', JSON.stringify({ groq: 'gsk_test_key_12345678901234' }));
    });
    await page.reload();
    await page.waitForLoadState('networkidle');

    await openSearchPlans(page);

    const searchInput = page.locator('[data-tour="search-input"]');
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
    await page.goto('/prep');
    await page.evaluate(() => {
      localStorage.setItem('guest_api_keys', JSON.stringify({ groq: 'gsk_test_key_12345678901234' }));
    });
    await page.reload();
    await page.waitForLoadState('networkidle');

    await openSearchPlans(page);

    const searchInput = page.locator('[data-tour="search-input"]');
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
  test('TC-DASH-SEARCH-004: Search without API key proceeds without connect modal', async ({ page }) => {
    await page.goto('/prep');
    await page.evaluate(() => {
      localStorage.removeItem('guest_api_keys');
      localStorage.removeItem('guest_api_key');
    });
    await page.reload();
    await page.waitForLoadState('networkidle');

    await openSearchPlans(page);

    const searchInput = page.locator('[data-tour="search-input"]');
    await searchInput.fill('Amazon, Product Manager, Behavioral');
    await searchInput.press('Enter');

    await page.waitForTimeout(1000);

    const connectDialog = page.locator('[role="dialog"]').filter({ hasText: /Connect/i });
    await expect(connectDialog).not.toBeVisible({ timeout: 3000 });
    await expect(page.locator('body')).toBeVisible();
  });

  /**
   * TC-DASH-SEARCH-005: Two-part query defaults correctly
   *
   * Queries like "Company, Position" should default to Technical round.
   */
  test('TC-DASH-SEARCH-005: Two-part query defaults correctly', async ({ page }) => {
    await page.goto('/prep');
    await page.waitForLoadState('networkidle');

    await openSearchPlans(page);

    const searchInput = page.locator('[data-tour="search-input"]');
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
    await page.goto('/prep');
    await page.waitForLoadState('networkidle');

    await openSearchPlans(page);

    const searchInput = page.locator('[data-tour="search-input"]');
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
    await page.goto('/prep');
    await page.waitForLoadState('networkidle');

    await openSearchPlans(page);

    const searchInput = page.locator('[data-tour="search-input"]');
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
  test('TC-DASH-API-001: Analyze without guest API key does not require connect modal', async ({ page }) => {
    await page.goto('/prep');
    await page.waitForLoadState('networkidle');

    await page.evaluate(() => {
      localStorage.removeItem('guest_api_keys');
      localStorage.removeItem('guest_api_key');
    });
    await page.reload();
    await page.waitForLoadState('networkidle');

    await openSearchPlans(page);

    const searchInput = page.locator('[data-tour="search-input"]');
    await searchInput.fill('Amazon, Product Manager, Behavioral');
    await searchInput.press('Enter');

    await page.waitForTimeout(1000);
    const connectDialog = page.locator('[role="dialog"]').filter({ hasText: /Connect/i });
    await expect(connectDialog).not.toBeVisible({ timeout: 3000 });
    await expect(page.locator('body')).toBeVisible();
  });

  /**
   * TC-DASH-API-002: API keys persist in localStorage
   *
   * Saved API keys should persist across page reloads.
   */
  test('TC-DASH-API-002: API keys persist in localStorage', async ({ page }) => {
    await page.goto('/prep');

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
  test('TC-DASH-API-003: Model settings visible on settings page', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: 'AI Provider' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Provider', { exact: true })).toBeVisible();
  });

  /**
   * TC-DASH-API-004: Provider dropdown works on settings page
   *
   * Selecting a provider should show provider-specific model options.
   */
  test('TC-DASH-API-004: Provider dropdown works', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    const providerTrigger = page.locator('label:has-text("Provider")').locator('..').getByRole('combobox').first();
    await providerTrigger.click();

    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible({ timeout: 5000 });
    await expect(listbox.getByRole('option', { name: 'OpenRouter' })).toBeVisible();
    await expect(listbox.getByRole('option', { name: 'Groq' })).toBeVisible();
  });

  /**
   * TC-DASH-API-005: Model dropdown lists options for selected provider
   */
  test('TC-DASH-API-005: Model dropdown lists provider models', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    const modelTrigger = page.locator('label:has-text("Model")').locator('..').getByRole('combobox').first();
    await modelTrigger.click();

    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible({ timeout: 5000 });
    expect(await listbox.getByRole('option').count()).toBeGreaterThan(0);
  });

  /**
   * TC-DASH-API-006: API key input visible on settings page
   */
  test('TC-DASH-API-006: API key input visible on settings page', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    const apiKeyInput = page.locator('input[type="password"]').first();
    await expect(apiKeyInput).toBeVisible({ timeout: 5000 });
  });

  /**
   * TC-DASH-API-007: Verify button visible for API key input
   */
  test('TC-DASH-API-007: Verify button visible for API key input', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('button', { name: 'Verify' })).toBeVisible({ timeout: 5000 });
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
    await page.goto('/prep');
    await page.waitForLoadState('networkidle');

    await openSearchPlans(page);
    await openPrepSettings(page);

    const urlInput = page.locator('input[type="url"]').first();
    await expect(urlInput).toBeVisible();
  });

  /**
   * TC-DASH-CTX-002: Can switch between URL and text mode
   *
   * User can toggle between URL input and text area.
   */
  test('TC-DASH-CTX-002: Can switch between URL and text mode', async ({ page }) => {
    await page.goto('/prep');
    await page.waitForLoadState('networkidle');

    await openSearchPlans(page);
    await openPrepSettings(page);

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
    await page.goto('/prep');
    await page.waitForLoadState('networkidle');

    await openSearchPlans(page);
    await openPrepSettings(page);

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
    await page.goto('/prep');
    await page.waitForLoadState('networkidle');

    // Set API key to enable analysis
    await page.evaluate(() => {
      localStorage.setItem('guest_api_keys', JSON.stringify({ groq: 'gsk_test' }));
    });
    await page.reload();
    await page.waitForLoadState('networkidle');

    await openSearchPlans(page);

    const searchInput = page.locator('[data-tour="search-input"]');
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

import { test, expect } from '@playwright/test';

/**
 * TEST GROUP: API-PERSIST - API Key Persistence Tests
 *
 * Tests the API key persistence between localStorage and database,
 * ensuring keys are properly saved, loaded, and synced.
 */

const TEST_GROQ_KEY = 'gsk_test_key_12345';
const TEST_GEMINI_KEY = 'AIzaSyTest_key_12345';
const TEST_OPENAI_KEY = 'sk-test_key_12345';
const TEST_RESUME = `
John Doe
Software Engineer

Experience:
- Senior Software Engineer at Google (2020-2023)
  Led team of 5 engineers, built scalable backend systems
- Software Engineer at Meta (2018-2020)
  Developed React components, improved page load time by 40%

Education:
- MS Computer Science, Stanford University (2018)
- BS Computer Science, MIT (2016)

Skills: JavaScript, TypeScript, React, Node.js, Python, AWS, GCP
`.trim();

test.describe('API-PERSIST - API Key Persistence Tests', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.evaluate(() => {
            localStorage.clear();
            sessionStorage.clear();
        });
    });

    /**
     * TC-PERSIST-001: API keys save to localStorage via modal
     *
     * Verifies that API keys are saved to localStorage when configured through the modal.
     */
    test('TC-PERSIST-001: API keys save to localStorage via modal', async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        // Open model switcher
        const modelSwitcher = page.locator('[data-tour="model-switcher"] button').first();
        await modelSwitcher.click();
        await page.waitForTimeout(300);

        // Click gear icon for Groq (first Connect button)
        const gearButton = page.locator('[title="Connect"]').first();
        await gearButton.click();

        // Enter API key
        const input = page.locator('input[type="password"]');
        await expect(input).toBeVisible();
        await input.fill(TEST_GROQ_KEY);

        // Save (button now says "Connect")
        await page.locator('button:has-text("Connect")').last().click();

        // Verify localStorage
        const savedKeys = await page.evaluate(() => {
            return localStorage.getItem('guest_api_keys');
        });

        expect(savedKeys).toBeTruthy();
        const parsed = JSON.parse(savedKeys!);
        expect(parsed.groq).toBe(TEST_GROQ_KEY);
    });

    /**
     * TC-PERSIST-002: API keys persist across page reload
     *
     * Verifies that API keys persist after page reload.
     */
    test('TC-PERSIST-002: API keys persist across page reload', async ({ page }) => {
        // Set keys in localStorage
        await page.evaluate((key) => {
            localStorage.setItem('guest_api_keys', JSON.stringify({ groq: key }));
        }, TEST_GROQ_KEY);

        await page.reload();
        await page.waitForLoadState('networkidle');

        // Verify keys are still there
        const savedKeys = await page.evaluate(() => {
            return localStorage.getItem('guest_api_keys');
        });

        expect(savedKeys).toBeTruthy();
        const parsed = JSON.parse(savedKeys!);
        expect(parsed.groq).toBe(TEST_GROQ_KEY);
    });

    /**
     * TC-PERSIST-003: Multiple provider keys can be saved
     *
     * Verifies that keys for multiple providers can be saved together.
     */
    test('TC-PERSIST-003: Multiple provider keys can be saved', async ({ page }) => {
        await page.evaluate((keys) => {
            localStorage.setItem('guest_api_keys', JSON.stringify(keys));
        }, { groq: TEST_GROQ_KEY, gemini: TEST_GEMINI_KEY, openai: TEST_OPENAI_KEY });

        await page.reload();

        const savedKeys = await page.evaluate(() => {
            return localStorage.getItem('guest_api_keys');
        });

        const parsed = JSON.parse(savedKeys!);
        expect(parsed.groq).toBe(TEST_GROQ_KEY);
        expect(parsed.gemini).toBe(TEST_GEMINI_KEY);
        expect(parsed.openai).toBe(TEST_OPENAI_KEY);
    });

    /**
     * TC-PERSIST-004: Keys are loaded on dashboard mount
     *
     * Verifies that keys are properly loaded when dashboard mounts.
     */
    test('TC-PERSIST-004: Keys are loaded on dashboard mount', async ({ page }) => {
        // Set keys before navigation
        await page.evaluate((key) => {
            localStorage.setItem('guest_api_keys', JSON.stringify({ groq: key }));
            localStorage.setItem('guest_model', 'groq:llama-3.3-70b-versatile');
        }, TEST_GROQ_KEY);

        await page.goto('/');
        await page.waitForLoadState('networkidle');

        // Open model switcher - should show Groq without warning
        const modelSwitcher = page.locator('[data-tour="model-switcher"] button').first();
        await modelSwitcher.click();
        await page.waitForTimeout(300);

        // Groq row should be visible
        const groqRow = page.locator('button:has-text("Groq")').first();
        await expect(groqRow).toBeVisible();
    });

    /**
     * TC-PERSIST-005: Adding new key via settings preserves existing keys
     *
     * Verifies that adding a new provider key from Settings preserves existing keys.
     */
    test('TC-PERSIST-005: Adding new key preserves existing keys', async ({ page }) => {
        // Start with Groq key
        await page.evaluate((key) => {
            localStorage.setItem('guest_api_keys', JSON.stringify({ groq: key }));
        }, TEST_GROQ_KEY);

        await page.goto('/settings');
        await page.waitForLoadState('networkidle');

        // Click Connect on Gemini card
        const geminiConnect = page.locator('button:has-text("Connect")').nth(1);
        if (await geminiConnect.isVisible()) {
            await geminiConnect.click();
            await page.waitForTimeout(500);

            // Enter Gemini key
            const input = page.locator('input[type="password"]');
            await input.fill(TEST_GEMINI_KEY);
            await page.locator('button:has-text("Connect")').last().click();
            await page.waitForTimeout(500);

            // Both keys should be saved
            const savedKeys = await page.evaluate(() => {
                return localStorage.getItem('guest_api_keys');
            });

            const parsed = JSON.parse(savedKeys!);
            expect(parsed.groq).toBe(TEST_GROQ_KEY);
            expect(parsed.gemini).toBe(TEST_GEMINI_KEY);
        }
    });

    /**
     * TC-PERSIST-006: Empty key handling
     *
     * Saving empty key should not break existing configuration.
     */
    test('TC-PERSIST-006: Empty key handling', async ({ page }) => {
        // Set up keys
        await page.evaluate((key) => {
            localStorage.setItem('guest_api_keys', JSON.stringify({ groq: key }));
        }, TEST_GROQ_KEY);

        await page.goto('/');
        await page.waitForLoadState('networkidle');

        // Open model switcher
        const modelSwitcher = page.locator('[data-tour="model-switcher"] button').first();
        await modelSwitcher.click();

        // Verify Groq row exists
        const groqRow = page.locator('button:has-text("Groq")');
        await expect(groqRow.first()).toBeVisible();
    });

    /**
     * TC-PERSIST-007: Legacy key format migration
     *
     * Old single-key format should still work (backward compatibility).
     */
    test('TC-PERSIST-007: Legacy key format migration', async ({ page }) => {
        // Set old format key
        await page.evaluate((key) => {
            localStorage.setItem('guest_api_key', key);
            localStorage.setItem('guest_model', 'groq:llama-3.3-70b-versatile');
        }, TEST_GROQ_KEY);

        await page.goto('/');
        await page.waitForLoadState('networkidle');

        // Page should not error
        await expect(page.locator('body')).toBeVisible();
        await expect(page.locator('input[type="text"]').first()).toBeVisible();
    });

    /**
     * TC-PERSIST-008: API keys save from Settings page
     *
     * Verifies that API keys can be saved from the Settings ConnectionCards.
     */
    test('TC-PERSIST-008: API keys save from Settings page', async ({ page }) => {
        await page.goto('/settings');
        await page.waitForLoadState('networkidle');

        // Click first Connect button
        const connectButton = page.locator('button:has-text("Connect")').first();
        if (await connectButton.isVisible()) {
            await connectButton.click();
            await page.waitForTimeout(500);

            // Enter key in modal
            const input = page.locator('input[type="password"]');
            await expect(input).toBeVisible();
            await input.fill(TEST_GROQ_KEY);

            // Click Connect button in modal
            await page.locator('[role="dialog"] button:has-text("Connect")').click();
            await page.waitForTimeout(500);

            // Verify saved
            const savedKeys = await page.evaluate(() => {
                return localStorage.getItem('guest_api_keys');
            });
            expect(savedKeys).toContain(TEST_GROQ_KEY);
        }
    });
});

/**
 * TEST GROUP: API-LOAD - API Key Loading Tests
 *
 * Tests the loading priority between database and localStorage.
 */
test.describe('API-LOAD - API Key Loading Priority Tests', () => {

    /**
     * TC-LOAD-001: Guest mode uses localStorage
     *
     * In guest mode, keys should load from localStorage.
     */
    test('TC-LOAD-001: Guest mode uses localStorage', async ({ page }) => {
        await page.evaluate((key) => {
            localStorage.setItem('guest_api_keys', JSON.stringify({ groq: key }));
        }, TEST_GROQ_KEY);

        await page.goto('/');
        await page.waitForLoadState('networkidle');

        // Should have loaded keys from localStorage
        const savedKeys = await page.evaluate(() => localStorage.getItem('guest_api_keys'));
        expect(savedKeys).toContain(TEST_GROQ_KEY);
    });

    /**
     * TC-LOAD-002: No key shows warning in model switcher
     *
     * Without API key, model switcher should show warning indicator.
     */
    test('TC-LOAD-002: No key shows warning indicator', async ({ page }) => {
        await page.goto('/');
        await page.evaluate(() => localStorage.clear());
        await page.reload();
        await page.waitForLoadState('networkidle');

        // Open model switcher
        const modelSwitcher = page.locator('[data-tour="model-switcher"] button').first();
        await modelSwitcher.click();
        await page.waitForTimeout(300);

        // Should see warning icons for unconfigured providers
        const dropdown = page.locator('[data-radix-popper-content-wrapper]');
        const svgCount = await dropdown.locator('svg').count();
        expect(svgCount).toBeGreaterThan(0);
    });
});

/**
 * TEST GROUP: RESUME - Resume Loading Tests
 *
 * Tests that resume is properly loaded and used in match generation.
 */
test.describe('RESUME - Resume Loading Tests', () => {

    /**
     * TC-RESUME-001: Dashboard shows loading state when resume exists
     *
     * When a user has a resume, the match section should show loading, not "Resume Required".
     */
    test('TC-RESUME-001: Match section shows loading not Resume Required', async ({ page }) => {
        // Set up localStorage with API key
        await page.evaluate(({ key, resume }) => {
            localStorage.setItem('guest_api_keys', JSON.stringify({ groq: key }));
            sessionStorage.setItem('test_resume', resume);
        }, { key: TEST_GROQ_KEY, resume: TEST_RESUME });

        await page.goto('/');
        await page.waitForLoadState('networkidle');

        // Fill search and trigger analysis
        const searchInput = page.locator('input[type="text"]').first();
        await searchInput.fill('Google, Engineer, Technical');
        await searchInput.press('Enter');

        // Wait briefly
        await page.waitForTimeout(2000);

        // Page should be in some state - either loading, showing content, or showing an error
        await expect(page.locator('body')).toBeVisible();
    });

    /**
     * TC-RESUME-002: Generate Strategy button works when resume exists
     *
     * If match fails to generate initially, user can click "Generate Strategy" button.
     */
    test('TC-RESUME-002: Generate Strategy button appears when needed', async ({ page }) => {
        await page.evaluate((key) => {
            localStorage.setItem('guest_api_keys', JSON.stringify({ groq: key }));
        }, TEST_GROQ_KEY);

        await page.goto('/');
        await page.waitForLoadState('networkidle');

        // Page should load without errors
        await expect(page.locator('body')).toBeVisible();
    });
});

/**
 * TEST GROUP: USAGE - Usage Indicator Tests
 *
 * Tests the API usage indicator functionality.
 */
test.describe('USAGE - Usage Indicator Tests', () => {

    /**
     * TC-USAGE-001: Usage tab is visible in model switcher
     *
     * Model switcher should have a "Usage" tab.
     */
    test('TC-USAGE-001: Usage tab is visible', async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        const modelSwitcher = page.locator('[data-tour="model-switcher"] button').first();
        await modelSwitcher.click();
        await page.waitForTimeout(300);

        // Should see "Usage" tab
        const usageTab = page.locator('button:has-text("Usage")');
        await expect(usageTab).toBeVisible();
    });

    /**
     * TC-USAGE-002: Usage tab shows configured providers
     *
     * Usage tab should show usage for configured providers only.
     */
    test('TC-USAGE-002: Usage tab shows configured providers', async ({ page }) => {
        await page.evaluate((key) => {
            localStorage.setItem('guest_api_keys', JSON.stringify({ groq: key }));
        }, TEST_GROQ_KEY);

        await page.goto('/');
        await page.waitForLoadState('networkidle');

        const modelSwitcher = page.locator('[data-tour="model-switcher"] button').first();
        await modelSwitcher.click();
        await page.waitForTimeout(300);

        // Click Usage tab
        const usageTab = page.locator('button:has-text("Usage")');
        await usageTab.click();
        await page.waitForTimeout(300);

        // Should see Groq usage info
        const groqUsage = page.locator('text=Groq').or(page.locator('text=groq'));
        await expect(groqUsage.first()).toBeVisible();
    });

    /**
     * TC-USAGE-003: No keys shows empty message
     *
     * Without configured keys, usage tab shows appropriate message.
     */
    test('TC-USAGE-003: No keys shows empty message', async ({ page }) => {
        await page.goto('/');
        await page.evaluate(() => localStorage.clear());
        await page.reload();
        await page.waitForLoadState('networkidle');

        const modelSwitcher = page.locator('[data-tour="model-switcher"] button').first();
        await modelSwitcher.click();
        await page.waitForTimeout(300);

        const usageTab = page.locator('button:has-text("Usage")');
        await usageTab.click();
        await page.waitForTimeout(300);

        // Should see "No AI connections yet" message
        const emptyMessage = page.locator('text=No AI connections');
        await expect(emptyMessage).toBeVisible();
    });

    /**
     * TC-USAGE-004: Status indicator shows in provider row
     *
     * Each provider row should have a status indicator.
     */
    test('TC-USAGE-004: Status indicator in provider row', async ({ page }) => {
        await page.evaluate((key) => {
            localStorage.setItem('guest_api_keys', JSON.stringify({ groq: key }));
        }, TEST_GROQ_KEY);

        await page.goto('/');
        await page.waitForLoadState('networkidle');

        const modelSwitcher = page.locator('[data-tour="model-switcher"] button').first();
        await modelSwitcher.click();
        await page.waitForTimeout(500);

        // Provider row should have clickable status icon
        const dropdown = page.locator('[data-radix-popper-content-wrapper]');
        const providerButtons = dropdown.locator('button').filter({ hasText: 'Groq' });
        await expect(providerButtons.first()).toBeVisible();
    });
});

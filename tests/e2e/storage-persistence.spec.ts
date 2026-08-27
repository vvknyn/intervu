import { test, expect } from '@playwright/test';
import { test as authTest } from './helpers/auth-gate';

/**
 * TEST GROUP: STORAGE - Cross-Page Storage Persistence Tests
 *
 * Tests that localStorage data persists correctly across page navigations,
 * covering resume data, dashboard state, prep settings, theme, and API keys.
 *
 * `/settings` is auth-gated (AUTH_GATED_PRODUCT_PREFIXES). A signed-out
 * visit bounces off-origin before the page (and its localStorage reads)
 * ever run, so the tests that read localStorage back right after landing
 * on `/settings` (001, 002, 003, 005) go through
 * tests/e2e/helpers/auth-gate.ts and need a real signed-in session. 004
 * only passes *through* `/settings` without reading state there, so it is
 * unaffected.
 */

test.describe('STORAGE - Cross-Page Storage Persistence Tests', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.evaluate(() => {
            localStorage.clear();
            sessionStorage.clear();
        });
    });

    /**
     * TC-STORAGE-001: API keys persist across page navigations
     *
     * API keys set on the dashboard should be available on the settings page.
     */
    authTest('TC-STORAGE-001: API keys persist across page navigations', async ({ page }) => {
        await page.evaluate(() => {
            localStorage.setItem('guest_api_keys', JSON.stringify({ groq: 'gsk_test_key_abc123' }));
        });

        // Navigate to settings
        await page.goto('/settings');
        await page.waitForLoadState('networkidle');

        // Verify key is still in localStorage
        const keys = await page.evaluate(() => localStorage.getItem('guest_api_keys'));
        expect(keys).toContain('gsk_test_key_abc123');

        // Navigate to yours
        await page.goto('/yours');
        await page.waitForLoadState('networkidle');

        const keys2 = await page.evaluate(() => localStorage.getItem('guest_api_keys'));
        expect(keys2).toContain('gsk_test_key_abc123');

        // Navigate back to dashboard
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        const keys3 = await page.evaluate(() => localStorage.getItem('guest_api_keys'));
        expect(keys3).toContain('gsk_test_key_abc123');
    });

    /**
     * TC-STORAGE-002: Theme setting persists across pages
     *
     * Theme chosen in settings should persist across navigation.
     */
    authTest('TC-STORAGE-002: Theme setting persists across pages', async ({ page }) => {
        await page.evaluate(() => {
            localStorage.setItem('interview-os-theme', 'dark');
        });

        // Navigate to multiple pages
        await page.goto('/settings');
        const theme1 = await page.evaluate(() => localStorage.getItem('interview-os-theme'));
        expect(theme1).toBe('dark');

        await page.goto('/');
        const theme2 = await page.evaluate(() => localStorage.getItem('interview-os-theme'));
        expect(theme2).toBe('dark');

        await page.goto('/yours');
        const theme3 = await page.evaluate(() => localStorage.getItem('interview-os-theme'));
        expect(theme3).toBe('dark');
    });

    /**
     * TC-STORAGE-003: Prep settings persist across pages
     *
     * Dashboard prep settings (model, provider) should persist.
     */
    authTest('TC-STORAGE-003: Prep settings persist across pages', async ({ page }) => {
        await page.evaluate(() => {
            localStorage.setItem('guest_model', 'groq:openai/gpt-oss-20b');
            localStorage.setItem('interview-os-prep-settings', JSON.stringify({
                questionCount: 5,
                difficulty: 'medium'
            }));
        });

        await page.goto('/settings');
        const model = await page.evaluate(() => localStorage.getItem('guest_model'));
        expect(model).toBe('groq:openai/gpt-oss-20b');

        const prepSettings = await page.evaluate(() => localStorage.getItem('interview-os-prep-settings'));
        expect(prepSettings).toContain('medium');

        // Navigate back
        await page.goto('/');
        const model2 = await page.evaluate(() => localStorage.getItem('guest_model'));
        expect(model2).toBe('groq:openai/gpt-oss-20b');
    });

    /**
     * TC-STORAGE-004: Resume data persists in localStorage
     *
     * Resume data stored in localStorage should persist.
     */
    test('TC-STORAGE-004: Resume data persists in localStorage', async ({ page }) => {
        const testResume = 'John Doe\nSoftware Engineer\nSkills: React, TypeScript';
        await page.evaluate((resume) => {
            localStorage.setItem('interview-os-resume-data', resume);
        }, testResume);

        // Navigate away and back
        await page.goto('/settings');
        await page.goto('/yours');

        const storedResume = await page.evaluate(() => localStorage.getItem('interview-os-resume-data'));
        expect(storedResume).toContain('John Doe');
    });

    /**
     * TC-STORAGE-005: Privacy notice dismiss persists
     *
     * Dismissing the privacy notice should persist across pages and reloads.
     */
    authTest('TC-STORAGE-005: Privacy notice dismiss persists', async ({ page }) => {
        await page.evaluate(() => {
            localStorage.setItem('privacy-notice-dismissed', 'true');
        });

        await page.goto('/');
        const dismissed1 = await page.evaluate(() => localStorage.getItem('privacy-notice-dismissed'));
        expect(dismissed1).toBe('true');

        // Reload
        await page.reload();
        const dismissed2 = await page.evaluate(() => localStorage.getItem('privacy-notice-dismissed'));
        expect(dismissed2).toBe('true');

        // Navigate to another page
        await page.goto('/settings');
        const dismissed3 = await page.evaluate(() => localStorage.getItem('privacy-notice-dismissed'));
        expect(dismissed3).toBe('true');
    });

    /**
     * TC-STORAGE-006: Multiple storage items coexist
     *
     * Multiple localStorage items should coexist without overwriting each other.
     */
    test('TC-STORAGE-006: Multiple storage items coexist', async ({ page }) => {
        await page.evaluate(() => {
            localStorage.setItem('guest_api_keys', JSON.stringify({ groq: 'gsk_test' }));
            localStorage.setItem('guest_model', 'groq:openai/gpt-oss-20b');
            localStorage.setItem('interview-os-theme', 'dark');
            localStorage.setItem('interview-os-prep-settings', JSON.stringify({ difficulty: 'hard' }));
            localStorage.setItem('privacy-notice-dismissed', 'true');
        });

        await page.reload();

        const apiKeys = await page.evaluate(() => localStorage.getItem('guest_api_keys'));
        const model = await page.evaluate(() => localStorage.getItem('guest_model'));
        const theme = await page.evaluate(() => localStorage.getItem('interview-os-theme'));
        const prep = await page.evaluate(() => localStorage.getItem('interview-os-prep-settings'));
        const privacy = await page.evaluate(() => localStorage.getItem('privacy-notice-dismissed'));

        expect(apiKeys).toContain('gsk_test');
        expect(model).toBe('groq:openai/gpt-oss-20b');
        expect(theme).toBe('dark');
        expect(prep).toContain('hard');
        expect(privacy).toBe('true');
    });

    /**
     * TC-STORAGE-007: Cache keys use correct prefix
     *
     * Verifies that cache keys use the interview-os prefix (backward compatibility).
     */
    test('TC-STORAGE-007: Cache keys use correct prefix', async ({ page }) => {
        await page.evaluate(() => {
            localStorage.setItem('interview-os-cache-test', 'cached-value');
        });

        await page.reload();

        const cached = await page.evaluate(() => localStorage.getItem('interview-os-cache-test'));
        expect(cached).toBe('cached-value');
    });

    /**
     * TC-STORAGE-008: localStorage clear removes all app data
     *
     * Clearing localStorage should remove all application data.
     */
    test('TC-STORAGE-008: localStorage clear removes all app data', async ({ page }) => {
        // Set multiple items
        await page.evaluate(() => {
            localStorage.setItem('guest_api_keys', JSON.stringify({ groq: 'gsk_test' }));
            localStorage.setItem('guest_model', 'groq:openai/gpt-oss-20b');
            localStorage.setItem('interview-os-theme', 'dark');
        });

        // Clear all
        await page.evaluate(() => localStorage.clear());

        const apiKeys = await page.evaluate(() => localStorage.getItem('guest_api_keys'));
        const model = await page.evaluate(() => localStorage.getItem('guest_model'));
        const theme = await page.evaluate(() => localStorage.getItem('interview-os-theme'));

        expect(apiKeys).toBeNull();
        expect(model).toBeNull();
        expect(theme).toBeNull();
    });
});

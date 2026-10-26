import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * Saved-search chip: a raw boolean query reads as a short label, the full terms show in a tooltip on
 * hover/focus (pointer devices) and behind an info button on touch, and "N new" replaces "+N".
 * Guest path: the rows are seeded in the guest localStorage store, as `persistSavedSearch` writes them.
 */
const SHOTS = process.env.SHOTS_DIR ?? 'test-output/saved-search-label';
const BOOLEAN_Q = '"Product Manager" OR "Program Manager" OR "Growth PM"';
const TERMS = 'Product Manager, Program Manager, Growth PM';
// The name a save offers is the query, cut at 48 characters (`suggestSavedSearchName`).
const rawName = (q: string) => (q.length > 48 ? `${q.slice(0, 45)}…` : q);
const row = (id: string, name: string, q: string, origin?: 'resume') => ({
    id,
    name,
    href: `?q=${encodeURIComponent(q)}`,
    createdAt: '2026-10-20T00:00:00.000Z',
    ...(origin ? { origin } : {}),
});
const SEEDED = [
    row('1', rawName(BOOLEAN_Q), BOOLEAN_Q, 'resume'),
    row('2', '"Data Analyst" OR "BI Analyst"', '"Data Analyst" OR "BI Analyst"'),
    row('3', 'PM roles in Berlin', BOOLEAN_Q),
    row('4', 'designer', 'designer'),
];

async function openWithSavedSearches(page: Page) {
    await page.addInitScript((rows) => {
        window.localStorage.setItem('intervu.saved-searches', JSON.stringify(rows));
    }, SEEDED);
    await page.goto('/jobs?q=engineer&posted=any', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('saved-search-item').first()).toBeVisible({ timeout: 30_000 });
}

const chip = (page: Page, name: string) => page.getByTestId('saved-search-item').filter({ hasText: name });

test.describe('saved-search chip label — pointer device', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('labels, tooltip on hover and focus, no tooltip when the label shows everything', { tag: ['@J-ALERTS-49'] }, async ({ page }, info) => {
        test.skip(info.project.name === 'mobile', 'hover needs a pointer; the touch test covers the phone');
        await openWithSavedSearches(page);
        await expect(chip(page, 'Résumé keywords')).toBeVisible();
        await expect(chip(page, 'Data Analyst +1 more')).toBeVisible();
        await expect(chip(page, 'PM roles in Berlin')).toBeVisible();
        await expect(chip(page, 'designer')).toBeVisible();
        await expect(page.getByText('OR "Program Manager"')).toHaveCount(0);

        await chip(page, 'Résumé keywords').hover();
        await expect(page.getByRole('tooltip')).toHaveText(TERMS);
        await page.screenshot({ path: `${SHOTS}/${info.project.name}-1440-hover.png` });

        await page.mouse.move(0, 0);
        await chip(page, 'Data Analyst +1 more').focus();
        await expect(page.getByRole('tooltip').filter({ hasText: 'Data Analyst' })).toHaveText('Data Analyst, BI Analyst');

        await chip(page, 'Data Analyst +1 more').blur();
        await chip(page, 'designer').hover();
        await chip(page, 'PM roles in Berlin').hover();
        await expect(page.getByRole('tooltip')).toHaveCount(0);
        await expect(page.getByTestId('saved-search-terms-trigger').first()).toBeHidden();
        await expect(page.getByRole('button', { name: 'Remove saved search Résumé keywords' })).toBeVisible();
    });
});

test.describe('saved-search chip label — touch', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('terms are reachable without hover', { tag: ['@J-ALERTS-50'] }, async ({ page }, info) => {
        await openWithSavedSearches(page);
        await expect(chip(page, 'Résumé keywords')).toBeVisible();
        const triggers = page.getByTestId('saved-search-terms-trigger');
        await expect(triggers).toHaveCount(2); // résumé + legacy; the typed and single-term chips have none
        await triggers.first().tap();
        await expect(page.getByTestId('saved-search-terms').getByRole('listitem')).toHaveText(['Product Manager', 'Program Manager', 'Growth PM']);
        await page.screenshot({ path: `${SHOTS}/${info.project.name}-390-terms.png` });
    });
});

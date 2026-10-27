import type { Locator, Page } from '@playwright/test';
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

/** Points at the chip until its tooltip is open (Radix marks the trigger `data-state`): a hover that lands before the page's code ran opens nothing, so it is repeated. */
async function openTooltip(page: Page, target: Locator) {
    await expect(async () => {
        await page.mouse.move(0, 0);
        await target.hover();
        await expect(target).toHaveAttribute('data-state', /open/, { timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await expect(page.getByRole('tooltip')).toBeVisible();
    // The screenshot and the box are read once the entrance animation has ended.
    await page.getByRole('tooltip').evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
}

test.describe('saved-search chip label — pointer device', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('labels, tooltip on hover and focus, no tooltip when the label shows everything', { tag: ['@J-ALERTS-53'] }, async ({ page }, info) => {
        test.skip(info.project.name === 'mobile', 'hover needs a pointer; the touch test covers the phone');
        await openWithSavedSearches(page);
        await expect(chip(page, 'Résumé keywords')).toBeVisible();
        await expect(chip(page, 'Data Analyst +1 more')).toBeVisible();
        await expect(chip(page, 'PM roles in Berlin')).toBeVisible();
        await expect(chip(page, 'designer')).toBeVisible();
        await expect(page.getByText('OR "Program Manager"')).toHaveCount(0);

        await openTooltip(page, chip(page, 'Résumé keywords'));
        await expect(page.getByRole('tooltip')).toHaveText(TERMS);
        // It never covers the header's Search / Pricing / Sign in. Quiet nav (#1126) keeps one Sign in;
        // Create account is not a header control.
        // The role=tooltip node is a 1px screen-reader copy; the visible box is the popper wrapper.
        const tip = (await page.locator('[data-radix-popper-content-wrapper]').boundingBox())!;
        for (const id of ['search-submit', 'topbar-pricing', 'topbar-signin']) {
            const nav = await page.locator('header').getByTestId(id).first().boundingBox();
            expect(nav, `${id} is in the header`).not.toBeNull();
            const apart = tip.x + tip.width <= nav!.x || nav!.x + nav!.width <= tip.x || tip.y + tip.height <= nav!.y || nav!.y + nav!.height <= tip.y;
            expect(apart, `tooltip ${JSON.stringify(tip)} overlaps ${id} ${JSON.stringify(nav)}`).toBe(true);
        }
        await page.screenshot({ path: `${SHOTS}/${info.project.name}-1440-hover.png` });

        await page.mouse.move(0, 0);
        await chip(page, 'Data Analyst +1 more').focus();
        await expect(chip(page, 'Data Analyst +1 more')).toHaveAttribute('data-state', /open/);
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

    test('terms are reachable without hover', { tag: ['@J-ALERTS-54'] }, async ({ page }, info) => {
        await openWithSavedSearches(page);
        await expect(chip(page, 'Résumé keywords')).toBeVisible();
        const triggers = page.getByTestId('saved-search-terms-trigger');
        await expect(triggers).toHaveCount(2); // résumé + legacy; the typed and single-term chips have none
        await triggers.first().tap();
        const popover = page.getByTestId('saved-search-terms');
        await expect(popover.getByRole('listitem')).toHaveText(['Product Manager', 'Program Manager', 'Growth PM']);
        await popover.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
        const box = await popover.boundingBox();
        const view = page.viewportSize()!;
        expect(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= view.width && box.y + box.height <= view.height, `popover ${JSON.stringify(box)} inside ${view.width}x${view.height}`).toBe(true);
        await page.screenshot({ path: `${SHOTS}/${info.project.name}-390-terms.png` });
    });
});

import { test, expect } from '@playwright/test';

/**
 * TEST GROUP: YOURS - Tracker list & detail sheet tests
 */

function seedGuestPursuit(overrides: Partial<Record<string, unknown>> = {}) {
  const now = new Date().toISOString();
  return {
    id: 'guest-e2e-1',
    user_id: 'guest',
    company_name: 'Acme Corp',
    position: 'Staff Engineer',
    status: 'interested',
    job_id: 'job-e2e-1',
    job_snapshot: {
      title: 'Staff Engineer',
      company: 'Acme Corp',
      location: 'Remote',
      description: 'Build things.',
      apply_url: 'https://example.com/jobs/1',
    },
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

test.describe('YOURS - Redirect', () => {
  test('TC-YOURS-000: /applications redirects to /yours', async ({ page }) => {
    await page.goto('/applications');
    await expect(page).toHaveURL('/yours');
  });

  test('TC-YOURS-000b: /applications?view=new preserves the query param through the redirect', async ({ page }) => {
    await page.goto('/applications?view=new');
    await expect(page).toHaveURL('/yours?view=new');
  });
});

test.describe('YOURS - Guest, no pursuits', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
  });

  test('TC-YOURS-001: Yours page loads', async ({ page }) => {
    await page.goto('/yours');
    await expect(page).toHaveURL('/yours');
    await expect(page.locator('h1:has-text("Tracker")')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=404')).not.toBeVisible();
  });

  test('TC-YOURS-002: Guest empty state hierarchy — header track vs empty CTAs', async ({ page }) => {
    await page.goto('/yours');
    const empty = page.getByTestId('yours-guest-empty');
    await expect(empty).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('main').getByRole('button', { name: /track a role/i })).toBeVisible();
    await expect(empty.getByRole('link', { name: /browse verified roles/i })).toBeVisible();
    await expect(empty.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(empty.getByRole('button', { name: /track a role/i })).toHaveCount(0);
  });

  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
  ] as const) {
    test(`TC-YOURS-002b: Guest empty hides filter chrome and sits upper-third (${viewport.name})`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/yours');
      const empty = page.getByTestId('yours-guest-empty');
      await expect(empty).toBeVisible({ timeout: 10000 });
      await expect(page.getByTestId('tracker-search')).toHaveCount(0);
      await expect(page.getByTestId('tracker-kanban')).toHaveCount(0);
      const box = await empty.boundingBox();
      expect(box).not.toBeNull();
      const v = page.viewportSize()!;
      expect(box!.y).toBeGreaterThan(48);
      expect(box!.y).toBeLessThan(v.height * 0.42);
      const centerX = box!.x + box!.width / 2;
      expect(Math.abs(centerX - v.width / 2)).toBeLessThan(72);
    });
  }

  test('TC-YOURS-003: TopBar Tracker tab is visible with zero pursuits', async ({ page }) => {
    await page.goto('/yours');
    const link = page.getByTestId('topbar-tracker').or(page.getByTestId('mobile-topbar-tracker'));
    await expect(link.first()).toBeVisible({ timeout: 10000 });
    await expect(link.first()).toHaveAttribute('href', '/yours');
  });

  test('TC-YOURS-004: Unknown pursuit id shows not-found', async ({ page }) => {
    await page.goto('/yours/does-not-exist');
    await expect(page.getByTestId('pursuit-not-found')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('YOURS - Guest, one seeded pursuit', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate((seed) => {
      localStorage.clear();
      localStorage.setItem('intervu.pursuits.guest', JSON.stringify([seed]));
    }, seedGuestPursuit());
  });

  test('TC-YOURS-005: Pursuit row shows company, role, and status', async ({ page }) => {
    await page.goto('/yours');
    await expect(page.getByTestId('tracker-search')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('tracker-kanban')).toBeVisible({ timeout: 10000 });
    const row = page.getByTestId('pursuit-row').first();
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row).toContainText('Acme Corp');
    await expect(row).toContainText('Staff Engineer');
    await expect(row).toContainText('Saved');
  });

  test('TC-YOURS-006: TopBar Yours link appears with a pursuit present', async ({ page }) => {
    await page.goto('/yours');
    const link = page.getByTestId('topbar-tracker').or(page.getByTestId('mobile-topbar-tracker'));
    await expect(link.first()).toBeVisible({ timeout: 10000 });
    await expect(link.first()).toHaveAttribute('href', '/yours');
  });

  test('TC-YOURS-007: Row click opens the detail sheet below xl', async ({ page }) => {
    // G5e (Grok UX wave): sub-xl opens the sheet, xl+ navigates to the full
    // page (TC-YOURS-013 below) — pinned sub-xl here since Playwright's
    // default 1280x720 viewport IS the xl boundary (see jobs-first-screen
    // .spec.ts's own note on this trap).
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/yours');
    await page.getByTestId('pursuit-row').first().click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('dialog')).toContainText('Staff Engineer');
    await expect(page.getByRole('dialog')).toContainText('Acme Corp');
  });

  test('TC-YOURS-013: Row click navigates to the full pursuit page at xl+', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/yours');
    await page.getByTestId('pursuit-row').first().click();
    await expect(page).toHaveURL('/yours/guest-e2e-1');
    await expect(page.getByTestId('pursuit-stage')).toBeVisible({ timeout: 10000 });
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: 'Acme Corp' }).first()).toBeVisible();
    await expect(main.getByText('Staff Engineer').first()).toBeVisible();
  });

  test('TC-YOURS-008: Track a role opens the add sheet', async ({ page }) => {
    await page.goto('/yours');
    await page.getByRole('button', { name: /track a role/i }).first().click();
    await expect(page).toHaveURL('/yours?view=new');
    await expect(page.getByRole('dialog')).toContainText('Track a role');
    await expect(page.getByRole('dialog')).toContainText('One step');
  });

  test('TC-YOURS-009: Ended pursuit appears in the list when filter is all', async ({ page }) => {
    await page.goto('/');
    await page.evaluate((seed) => {
      localStorage.setItem(
        'intervu.pursuits.guest',
        JSON.stringify([seed, { ...seed, id: 'guest-e2e-2', company_name: 'Old Co', status: 'rejected' }]),
      );
    }, seedGuestPursuit());

    await page.goto('/yours');
    const rows = page.getByTestId('pursuit-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.last()).toContainText('Old Co');
  });
});

test.describe('YOURS - Guest manual pursuit (Track a role)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
  });

  // Retargeted 2026-08-08: these two used to drive the /jobs prep seed line
  // ("Already interviewing somewhere? Prep for it."), which has been removed
  // from the board entirely — the tracker's own persistent "Track a role"
  // button is the manual-pursuit entry point now, so that is what they
  // exercise. Same end assertions (a pursuit is created from typed
  // company/role alone and shows on /yours), with the stage the flow
  // actually sets: `TrackRoleSheet` defaults its status select to "applied"
  // ("Applied"), not the seed line's old hard-coded "interviewing".
  async function trackARole(page: import('@playwright/test').Page, company: string, role: string) {
    await page.getByRole('button', { name: /track a role/i }).first().click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible({ timeout: 10000 });
    await sheet.getByPlaceholder('Acme').fill(company);
    await sheet.getByPlaceholder('Staff Software Engineer').fill(role);
    await sheet.getByRole('button', { name: 'Save to tracker' }).click();
  }

  test('TC-YOURS-011: tracking a role by hand creates a guest pursuit and closes the sheet back to the tracker', async ({ page }) => {
    await page.goto('/yours');
    await expect(page.getByTestId('yours-guest-empty')).toBeVisible({ timeout: 10000 });

    await trackARole(page, 'Globex', 'Product Manager');

    await expect(page).toHaveURL('/yours');
    const row = page.getByTestId('pursuit-row').first();
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row).toContainText('Globex');
    await expect(row).toContainText('Product Manager');
  });

  test('TC-YOURS-012: a hand-tracked pursuit shows up on /yours as applied', async ({ page }) => {
    await page.goto('/yours');
    await expect(page.getByTestId('yours-guest-empty')).toBeVisible({ timeout: 10000 });
    await trackARole(page, 'Initech', 'Backend Engineer');
    await expect(page.getByTestId('pursuit-row').first()).toBeVisible({ timeout: 10000 });

    await page.goto('/yours');
    const row = page.getByTestId('pursuit-row').first();
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row).toContainText('Initech');
    await expect(row).toContainText('Backend Engineer');
    await expect(row).toContainText('Applied');
  });
});

test.describe('YOURS - Mobile', () => {
  test('TC-YOURS-010: Yours page is usable on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.goto('/yours');

    await expect(page.locator('body')).toBeVisible();
    await expect(page.locator('text=404')).not.toBeVisible();
  });
});

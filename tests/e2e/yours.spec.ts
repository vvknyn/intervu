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

  test('TC-YOURS-002: Guest empty state shows track and login actions', async ({ page }) => {
    await page.goto('/yours');
    const empty = page.getByTestId('yours-guest-empty');
    await expect(empty).toBeVisible({ timeout: 10000 });
    await expect(empty.getByRole('button', { name: /track a role/i })).toBeVisible();
    await expect(empty.getByRole('button', { name: 'Log in' })).toBeVisible();
  });

  test('TC-YOURS-003: TopBar Tracker tab is visible with zero pursuits', async ({ page }) => {
    await page.goto('/');
    const link = page.getByTestId('topbar-tracker');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/yours');
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
    const row = page.getByTestId('pursuit-row').first();
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row).toContainText('Acme Corp');
    await expect(row).toContainText('Staff Engineer');
    await expect(row).toContainText('Saved');
  });

  test('TC-YOURS-006: TopBar Yours link appears with a pursuit present', async ({ page }) => {
    await page.goto('/');
    const link = page.getByTestId('topbar-tracker');
    await expect(link).toBeVisible({ timeout: 10000 });
    await expect(link).toHaveAttribute('href', '/yours');
  });

  test('TC-YOURS-007: Row click opens the detail sheet', async ({ page }) => {
    await page.goto('/yours');
    await page.getByTestId('pursuit-row').first().click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('dialog')).toContainText('Staff Engineer');
    await expect(page.getByRole('dialog')).toContainText('Acme Corp');
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

test.describe('YOURS - Guest seed-line (search page -> prep)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
  });

  // jobs-list-tail class fix: `SearchSeedLine` now lives inside `ListTail`
  // (rendered only once the results list has genuinely ended) and inside
  // `EmptyResults` (rendered on zero hits) — never below the load-more
  // sentinel while browse-by-default's default list can still grow, which
  // it always can on a bare `/jobs` landing. `zzzzunfindablezzz` is the
  // same nonsense query jobs-first-screen.spec.ts's "zero results names the
  // excluders" test already relies on returning 0 hits against the live
  // corpus — reused here rather than inventing a second unfindable string,
  // so there's one query this suite trusts to mean "no results," not two.
  const ZERO_RESULTS_QUERY = 'zzzzunfindablezzz';

  test('TC-YOURS-011: submitting the seed line creates a guest pursuit and routes to tracker', async ({ page }) => {
    await page.goto(`/jobs?q=${ZERO_RESULTS_QUERY}`);
    await expect(page.getByText('No roles match.')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('prep-seed-line')).toBeVisible();
    await page.getByTestId('prep-seed-line').getByRole('button').click();

    const form = page.getByTestId('prep-seed-form');
    await expect(form).toBeVisible();
    await form.getByLabel('Company').fill('Globex');
    await form.getByLabel('Role').fill('Product Manager');
    await form.getByRole('button', { name: 'Prep for it' }).click();

    await expect(page).toHaveURL(/\/yours\/[^/?#]+/);
  });

  test('TC-YOURS-012: a seed-line pursuit shows up on /yours as interviewing', async ({ page }) => {
    await page.goto(`/jobs?q=${ZERO_RESULTS_QUERY}`);
    await expect(page.getByTestId('prep-seed-line')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('prep-seed-line').getByRole('button').click();
    const form = page.getByTestId('prep-seed-form');
    await form.getByLabel('Company').fill('Initech');
    await form.getByLabel('Role').fill('Backend Engineer');
    await form.getByRole('button', { name: 'Prep for it' }).click();
    await expect(page).toHaveURL(/\/yours\/[^/?#]+/);

    await page.goto('/yours');
    const row = page.getByTestId('pursuit-row').first();
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row).toContainText('Initech');
    await expect(row).toContainText('Backend Engineer');
    await expect(row).toContainText('Interviewing');
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

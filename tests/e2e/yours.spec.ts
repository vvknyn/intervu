import { test, expect } from '@playwright/test';

/**
 * TEST GROUP: YOURS - Pursuit List & Detail Tests
 *
 * Replaces applications.spec.ts (jobs-first-bloom PR 2, spec §4/§5): the
 * kanban status-grid tracker at /applications is gone — /applications 301s
 * to /yours, a next-action-first list of "pursuits" (src/app/yours/page.tsx,
 * src/app/yours/[id]/page.tsx). No auth wall: guests write pursuits to
 * localStorage (`intervu.pursuits.guest`, src/lib/pursuits/guest-store.ts)
 * and see them the same as a signed-in user reading Firestore — these tests
 * exercise the guest path since no login fixture exists in this suite.
 */

/** A minimal, valid guest pursuit matching `Pursuit` (src/lib/pursuits/types.ts). */
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

  /**
   * TC-YOURS-001: Yours page loads
   */
  test('TC-YOURS-001: Yours page loads', async ({ page }) => {
    await page.goto('/yours');
    await expect(page).toHaveURL('/yours');
    // Guest/empty renders the PageHeader title "Tracker"; the populated board
    // renders its own "Application tracker" h1 — both contain "Tracker".
    await expect(page.locator('h1:has-text("Tracker")')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=404')).not.toBeVisible();
  });

  /**
   * TC-YOURS-002: Guest with nothing local sees a login prompt, not an empty list
   */
  test('TC-YOURS-002: Guest empty state shows a login prompt', async ({ page }) => {
    await page.goto('/yours');
    const empty = page.getByTestId('yours-guest-empty');
    await expect(empty).toBeVisible({ timeout: 10000 });
    // Scoped to the empty-state card: the signed-out TopBar also renders its
    // own "Log in" button, so an unscoped lookup is ambiguous.
    await expect(empty.getByRole('button', { name: 'Log in' })).toBeVisible();
  });

  /**
   * TC-YOURS-003: TopBar "Tracker" tab is always visible, even with zero
   * pursuits (portal redesign spec, "Shell (TopBar)" — no longer conditional
   * on hasPursuits; all 4 tabs are always-visible now).
   */
  test('TC-YOURS-003: TopBar Tracker tab is visible with zero pursuits', async ({ page }) => {
    await page.goto('/');
    const link = page.getByTestId('topbar-yours');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/yours');
  });

  /**
   * TC-YOURS-004: A bogus pursuit id shows the not-found state, not a crash
   */
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

  /**
   * TC-YOURS-005: Seeded pursuit renders as a next-action row
   */
  test('TC-YOURS-005: Pursuit row shows company, role, and next action', async ({ page }) => {
    await page.goto('/yours');
    const row = page.getByTestId('pursuit-row').first();
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row).toContainText('Acme Corp');
    await expect(row).toContainText('Staff Engineer');
    await expect(row).toContainText('Tailor your resume to this role');
  });

  /**
   * TC-YOURS-006: TopBar "Yours" link appears once a pursuit exists
   */
  test('TC-YOURS-006: TopBar Yours link appears with a pursuit present', async ({ page }) => {
    await page.goto('/');
    const link = page.getByTestId('topbar-yours');
    await expect(link).toBeVisible({ timeout: 10000 });
    await expect(link).toHaveAttribute('href', '/yours');
  });

  /**
   * TC-YOURS-007: Clicking a row opens the pursuit detail page
   */
  test('TC-YOURS-007: Row click navigates to the pursuit detail page', async ({ page }) => {
    await page.goto('/yours');
    await page.getByTestId('pursuit-row').first().click();
    await expect(page).toHaveURL('/yours/guest-e2e-1');
    await expect(page.getByTestId('pursuit-stage')).toBeVisible({ timeout: 10000 });
  });

  /**
   * TC-YOURS-008: "Add manually" reaches the existing application wizard
   */
  test('TC-YOURS-008: Add manually opens the wizard', async ({ page }) => {
    await page.goto('/yours');
    await page.getByRole('button', { name: /add manually/i }).click();
    await expect(page).toHaveURL('/yours?view=new');
    // The wizard shell repeats the current step name in a mobile-only header
    // (`md:hidden`, pre-existing, predates this pass), so "Job Details"
    // renders as two h2s — `:visible` picks whichever one the viewport shows.
    await expect(page.locator('h2:has-text("Job Details"):visible')).toBeVisible({ timeout: 10000 });
  });

  /**
   * TC-YOURS-009: An ended pursuit (rejected/withdrawn) renders dimmed under
   * a collapsed "Closed (N)" details section, never in red (portal redesign
   * spec, "Page: Tracker (/yours)" — board columns don't include closed;
   * "Closed pursuits ... compact collapsed list under the board").
   */
  test('TC-YOURS-009: Ended pursuit sorts under the Closed section', async ({ page }) => {
    await page.goto('/');
    await page.evaluate((seed) => {
      localStorage.setItem(
        'intervu.pursuits.guest',
        JSON.stringify([seed, { ...seed, id: 'guest-e2e-2', company_name: 'Old Co', status: 'rejected' }]),
      );
    }, seedGuestPursuit());

    await page.goto('/yours');
    // "Closed" alone also names a stat-card tile above the board, so match
    // the collapsed section's own "Closed (N)" summary text specifically.
    await expect(page.locator('text=/Closed \\(\\d+\\)/')).toBeVisible({ timeout: 10000 });
    const rows = page.getByTestId('pursuit-row');
    await expect(rows).toHaveCount(2);
    // Closed row renders after the active board card.
    await expect(rows.last()).toContainText('Old Co');
  });
});

test.describe('YOURS - Guest seed-line (search page -> prep)', () => {
  /**
   * TC-YOURS-011/012: the search seed line (jobs-first-bloom PR3, spec §3
   * "outside interviews") — an always-present quiet line under the jobs
   * results on `/` for a visitor who's already interviewing somewhere else.
   * Guest path: `addManualGuestPursuit` (src/lib/pursuits/guest-store.ts)
   * writes straight to the same `intervu.pursuits.guest` localStorage key
   * `seedGuestPursuit` above seeds directly, so a submitted seed shows up on
   * /yours exactly like any other guest pursuit.
   */
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
  });

  test('TC-YOURS-011: submitting the seed line creates a guest pursuit and routes to /prep', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByTestId('prep-seed-line')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('prep-seed-line').click();

    const form = page.getByTestId('prep-seed-form');
    await expect(form).toBeVisible();
    await form.getByLabel('Company').fill('Globex');
    await form.getByLabel('Role').fill('Product Manager');
    await form.getByRole('button', { name: 'Prep for it' }).click();

    await expect(page).toHaveURL(/\/prep\?.*company=Globex.*/);
    await expect(page).toHaveURL(/pursuitId=/);
    await expect(page).toHaveURL(/searched=true/);
  });

  test('TC-YOURS-012: a seed-line pursuit shows up on /yours as interviewing', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('prep-seed-line').click();
    const form = page.getByTestId('prep-seed-form');
    await form.getByLabel('Company').fill('Initech');
    await form.getByLabel('Role').fill('Backend Engineer');
    await form.getByRole('button', { name: 'Prep for it' }).click();
    await expect(page).toHaveURL(/\/prep\?/);

    await page.goto('/yours');
    const row = page.getByTestId('pursuit-row').first();
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row).toContainText('Initech');
    await expect(row).toContainText('Backend Engineer');
    await expect(row).toContainText('Prep for this interview');
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

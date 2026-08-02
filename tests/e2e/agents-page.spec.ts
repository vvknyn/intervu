import { test, expect } from '@playwright/test';

/**
 * TEST GROUP: AGENTS - Public /agents page + llms.txt
 *
 * No auth required — /agents and /llms.txt are public, static surfaces (see
 * middleware.ts, which only gates /account). These assertions prove the page
 * carries its load-bearing facts (hero copy, connect address, the
 * never-submits promise) and that /llms.txt is a real, reachable file naming
 * the same MCP endpoint. Full manual/visual verification lives in
 * task-10-report.md.
 */
test.describe('AGENTS - Public agents page', () => {
  test('TC-AGENTS-001: /agents renders the hero', async ({ page }) => {
    await page.goto('/agents');
    await expect(page).toHaveURL('/agents');
    await expect(page.getByText('Only real jobs.', { exact: false })).toBeVisible();
  });

  test('TC-AGENTS-002: the connect URL is visible', async ({ page }) => {
    await page.goto('/agents');
    await expect(page.getByText('api/mcp', { exact: false }).first()).toBeVisible();
  });

  test('TC-AGENTS-003: the never-submits sentence is present', async ({ page }) => {
    await page.goto('/agents');
    await expect(
      page.getByText('intervu never submits applications for you', { exact: false })
    ).toBeVisible();
  });

  test('TC-AGENTS-004: /llms.txt returns 200 and names the MCP endpoint', async ({ request }) => {
    const res = await request.get('/llms.txt');
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain('api/mcp');
  });
});

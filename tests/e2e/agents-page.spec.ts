import { test, expect } from '@playwright/test';

/**
 * TEST GROUP: AGENTS - /connect (formerly /agents) + llms.txt
 *
 * `/agents` (the original public agent/MCP marketing page) was retired in
 * favor of `/connect` — the front-of-house's canonical human landing spot
 * for the same feature (page consolidation, 2026-08-02) — and now
 * permanently redirects there (next.config.ts). This file kept its original
 * name/script (`npm run test:agents-page`) but its assertions now target
 * `/connect`, plus a redirect check proving the old URL still lands
 * somewhere real for anyone with it bookmarked/linked.
 *
 * No auth required — /connect and /llms.txt are public, static surfaces
 * (see middleware.ts, which only gates /account). These assertions prove
 * the page carries its load-bearing facts (hero copy, connect address, the
 * never-submits promise) and that /llms.txt is a real, reachable file
 * naming the same MCP endpoint.
 */
test.describe('AGENTS - Public connect page', () => {
  test('TC-AGENTS-001: /agents redirects to /connect', async ({ page }) => {
    await page.goto('/agents');
    await expect(page).toHaveURL('/connect');
  });

  test('TC-AGENTS-002: /connect renders the hero', async ({ page }) => {
    await page.goto('/connect');
    await expect(page).toHaveURL('/connect');
    await expect(
      page.getByText('Your AI already knows how to job hunt.', { exact: false })
    ).toBeVisible();
  });

  test('TC-AGENTS-003: the connect URL is visible', async ({ page }) => {
    await page.goto('/connect');
    await expect(page.getByText('api/mcp', { exact: false }).first()).toBeVisible();
  });

  test('TC-AGENTS-004: the never-submits sentence is present', async ({ page }) => {
    await page.goto('/connect');
    await expect(
      page.getByText('intervu never submits applications for you', { exact: false })
    ).toBeVisible();
  });

  test('TC-AGENTS-005: /llms.txt returns 200 and names the MCP endpoint', async ({ request }) => {
    const res = await request.get('/llms.txt');
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain('api/mcp');
  });
});

import { test, expect } from '@playwright/test';
import { CONNECT_CLIENTS } from '../../src/lib/connect-clients';

/**
 * TEST GROUP: CONNECT — R2 user report (2026-08-09)
 *
 * Bug: choosing a client in the /connect picker only ever copied the MCP
 * connector URL — nothing actually opened the target app's connector
 * surface (connect-client.tsx:70,243 before the fix). Fix: each MCP-kind
 * client in CONNECT_CLIENTS (lib/connect-clients.ts — the one source of
 * truth) now carries an `openUrl`, rendered as an explicit "Open <client>"
 * link AFTER the copy step (copy stays the primary, load-bearing
 * instruction; opening the app configures nothing by itself).
 *
 * One test loops every MCP-kind client from the registry itself — no
 * per-client hardcoded test body — so a future client added to
 * CONNECT_CLIENTS is covered by construction, the same class-wide rule the
 * registry's own doc comment states.
 */
const MCP_CLIENTS = CONNECT_CLIENTS.filter((c) => c.kind === 'mcp');

test.describe('CONNECT', () => {
    for (const client of MCP_CLIENTS) {
        test(`"${client.label}" tab: Open link points at the verified vendor URL, opens in a new tab without leaking window.opener`, async ({ page }) => {
            await page.goto('/connect');
            await page.getByRole('tab', { name: new RegExp(client.label, 'i') }).click();

            const openLink = page.getByTestId('connect-open-client');
            await expect(openLink).toBeVisible();
            await expect(openLink).toHaveText(new RegExp(`Open ${client.label}`));
            await expect(openLink).toHaveAttribute('href', client.openUrl);
            await expect(openLink).toHaveAttribute('target', '_blank');
            await expect(openLink).toHaveAttribute('rel', 'noopener');
        });
    }

    test('copy stays the primary instruction: the copy button renders above the Open link (copy -> open reading order)', async ({ page }) => {
        await page.goto('/connect');
        const copyButton = page.getByRole('button', { name: 'Copy' });
        const openLink = page.getByTestId('connect-open-client');
        await expect(copyButton).toBeVisible();
        await expect(openLink).toBeVisible();
        const copyBox = await copyButton.boundingBox();
        const openBox = await openLink.boundingBox();
        expect(copyBox && openBox && copyBox.y).toBeLessThan(openBox!.y);
    });
});

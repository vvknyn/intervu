import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { BETA_UNLIMITED_CREDITS } from '../../src/lib/llm/credit-copy';

/**
 * TEST GROUP: COIN-BALANCE - TopBar credit indicator (PR #236)
 *
 * Proves a signed-in user's coin/credit balance renders in the TopBar,
 * positioned immediately before the profile avatar — not merely "somewhere
 * on the page" (this is the regression Vivek reported: "we used to show
 * that under the profile section logo").
 *
 * Auth is faked via the two dev-only e2e hooks — never real Firebase:
 *  - `window.__INTERVU_E2E_AUTH__` (src/lib/firebase/client-auth.ts) is read
 *    by `onAuthChange`/`getCurrentUser` ahead of the real Firebase SDK. Set
 *    via `page.addInitScript` so it exists before the app's first script runs.
 *  - the `intervu_e2e_credits` cookie (src/actions/credits.ts) is read by
 *    `getMyCreditsAction`'s server action, JSON-decoded into the credit
 *    state `CreditBalance.tsx` renders from. Set via `context.addCookies`.
 * Both hooks hard-return null when NODE_ENV === "production", so they are
 * inert outside local/e2e runs.
 */

type MockCredits = {
    isAdmin: boolean;
    allowance: number;
    earned: number;
    total: number;
    monthlyFree: number;
};

const BALANCE_TESTID = 'topbar-credit-balance';

function mockFirebaseUser() {
    // Only displayName/email are read anywhere on the render path
    // (TopBar's `initialsOf`) — the rest are plausible filler so the object
    // shape doesn't look suspicious to any future consumer, not because
    // anything here reads them.
    return {
        uid: 'e2e-coin-balance-uid',
        displayName: 'Ada Lovelace',
        email: 'ada@example.com',
        emailVerified: true,
        isAnonymous: false,
        providerData: [],
        metadata: {},
        photoURL: null,
        phoneNumber: null,
        providerId: 'password',
        tenantId: null,
        refreshToken: 'e2e-mock-refresh-token',
    };
}

async function signInAsMock(page: Page, context: BrowserContext, credits: MockCredits) {
    await page.addInitScript((user) => {
        (window as unknown as { __INTERVU_E2E_AUTH__: unknown }).__INTERVU_E2E_AUTH__ = user;
    }, mockFirebaseUser());

    await context.addCookies([
        {
            name: 'intervu_e2e_credits',
            value: encodeURIComponent(JSON.stringify(credits)),
            domain: 'localhost',
            path: '/',
        },
    ]);
}

/** DOM-order check: true when `before` genuinely precedes `after` in the
 *  document, not just "both exist". Fails closed (false) if either is
 *  missing, so a caller can't mistake "element absent" for "order wrong". */
async function precedesInDom(before: ReturnType<Page['getByTestId']>, afterTestId: string) {
    return before.evaluate((el, testId) => {
        const after = document.querySelector(`[data-testid="${testId}"]`);
        if (!after) return false;
        const position = el.compareDocumentPosition(after);
        return Boolean(position & Node.DOCUMENT_POSITION_FOLLOWING);
    }, afterTestId);
}

/**
 * Presence control for the absence assertions below.
 *
 * `toHaveCount(0)` passes just as happily when the test-id has been renamed as
 * when the chip is genuinely absent, so an absence assertion alone can silently
 * rot into a no-op. This briefly injects an element carrying the same test-id,
 * proves the locator finds it, then removes it — so a later count of 0 means
 * "the component chose not to render", not "the selector stopped matching".
 *
 * Until 2026-08-23 this job was done by the bring-your-own-key case, which was
 * the one state that still rendered the chip during beta. That state no longer
 * exists, so the control is made explicit rather than dropped with it.
 */
async function assertLocatorDetectsPresence(page: Page, testId: string) {
    await page.evaluate((id) => {
        const probe = document.createElement('div');
        probe.setAttribute('data-testid', id);
        probe.id = '__presence_probe__';
        document.body.appendChild(probe);
    }, testId);
    await expect(page.getByTestId(testId)).toHaveCount(1);

    await page.evaluate(() => document.getElementById('__presence_probe__')?.remove());
    await expect(page.getByTestId(testId)).toHaveCount(0);
}

test.describe('COIN-BALANCE - TopBar credit indicator', () => {
    test('TC-COIN-001: ordinary user sees their partial numeric balance, positioned before the avatar', async ({
        page,
        context,
    }) => {
        await signInAsMock(page, context, {
            isAdmin: false,
            allowance: 37,
            earned: 0,
            total: 37,
            monthlyFree: 40,
        });
        await page.goto('/jobs');
        await page.waitForLoadState('networkidle');

        const balance = page.getByTestId(BALANCE_TESTID);
        const avatar = page.getByTestId('topbar-avatar');
        await expect(avatar).toBeVisible();

        if (BETA_UNLIMITED_CREDITS) {
            // The gate never draws on the balance during beta, so the number
            // underneath is frozen and there is nothing honest to put in the
            // slot. The chip is omitted rather than showing a stuck counter or
            // a standing "Unlimited" badge.
            await assertLocatorDetectsPresence(page, BALANCE_TESTID);
            return;
        }

        await expect(balance).toBeVisible();
        await expect(balance).toContainText('37');

        expect(await precedesInDom(balance, 'topbar-avatar')).toBe(true);
    });

    test('TC-COIN-002: admin sees "Unlimited", not a number', async ({ page, context }) => {
        await signInAsMock(page, context, {
            isAdmin: true,
            allowance: 0,
            earned: 0,
            total: 0,
            monthlyFree: 40,
        });
        await page.goto('/jobs');
        await page.waitForLoadState('networkidle');

        const balance = page.getByTestId(BALANCE_TESTID);

        if (BETA_UNLIMITED_CREDITS) {
            // Beta covers every account, admin included, so the badge is
            // omitted here too. This test only passed during beta by
            // coincidence: it was reading the beta branch's "Unlimited", not
            // the admin one, so it asserted nothing about admins at all.
            await assertLocatorDetectsPresence(page, BALANCE_TESTID);
            return;
        }

        await expect(balance).toBeVisible();
        await expect(balance).toContainText('Unlimited');
        await expect(balance).not.toContainText(/\d/);

        expect(await precedesInDom(balance, 'topbar-avatar')).toBe(true);
    });
});

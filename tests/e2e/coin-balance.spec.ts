import { test, expect, type Page, type BrowserContext } from '@playwright/test';

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
    isBYOK: boolean;
    allowance: number;
    earned: number;
    total: number;
    monthlyFree: number;
};

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

test.describe('COIN-BALANCE - TopBar credit indicator', () => {
    test('TC-COIN-001: ordinary user sees their partial numeric balance, positioned before the avatar', async ({
        page,
        context,
    }) => {
        await signInAsMock(page, context, {
            isAdmin: false,
            isBYOK: false,
            allowance: 37,
            earned: 0,
            total: 37,
            monthlyFree: 40,
        });
        await page.goto('/jobs');
        await page.waitForLoadState('networkidle');

        const balance = page.getByTestId('topbar-credit-balance');
        const avatar = page.getByTestId('topbar-avatar');
        await expect(avatar).toBeVisible();
        await expect(balance).toBeVisible();
        await expect(balance).toContainText('37');

        expect(await precedesInDom(balance, 'topbar-avatar')).toBe(true);
    });

    test('TC-COIN-002: admin sees "Unlimited", not a number', async ({ page, context }) => {
        await signInAsMock(page, context, {
            isAdmin: true,
            isBYOK: false,
            allowance: 0,
            earned: 0,
            total: 0,
            monthlyFree: 40,
        });
        await page.goto('/jobs');
        await page.waitForLoadState('networkidle');

        const balance = page.getByTestId('topbar-credit-balance');
        await expect(balance).toBeVisible();
        await expect(balance).toContainText('Unlimited');
        await expect(balance).not.toContainText(/\d/);

        expect(await precedesInDom(balance, 'topbar-avatar')).toBe(true);
    });

    test('TC-COIN-003: BYOK user sees an own-key state, distinct from ordinary and admin', async ({
        page,
        context,
    }) => {
        await signInAsMock(page, context, {
            isAdmin: false,
            isBYOK: true,
            allowance: 0,
            earned: 0,
            total: 0,
            monthlyFree: 40,
        });
        await page.goto('/jobs');
        await page.waitForLoadState('networkidle');

        const balance = page.getByTestId('topbar-credit-balance');
        await expect(balance).toBeVisible();
        await expect(balance).toContainText('Your API key');
        await expect(balance).not.toContainText('Unlimited');
        await expect(balance).not.toContainText(/\d/);

        expect(await precedesInDom(balance, 'topbar-avatar')).toBe(true);
    });
});

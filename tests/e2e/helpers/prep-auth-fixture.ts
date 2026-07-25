import type { Page, BrowserContext } from '@playwright/test';
import type { IdTokenResult } from 'firebase/auth';

function e2eIdTokenResult(): IdTokenResult {
  const now = new Date().toISOString();
  return {
    token: 'e2e-mock-id-token',
    authTime: now,
    expirationTime: new Date(Date.now() + 3_600_000).toISOString(),
    issuedAtTime: now,
    signInProvider: 'password',
    signInSecondFactor: null,
    claims: {},
  };
}

export type E2EPrepEntitlement = {
  isAdmin: boolean;
  isBYOK: boolean;
  credits: number;
  monthlyFree: number;
};

const E2E_CREDITS_COOKIE = 'intervu_e2e_credits';

/** Minimal Firebase User shape — DashboardContainer only checks truthiness. */
const E2E_MOCK_USER = {
  uid: 'e2e-prep-user',
  email: 'e2eprep@intervu.cc',
  emailVerified: true,
  displayName: 'E2E Prep User',
  isAnonymous: false,
  providerData: [],
  metadata: {},
  refreshToken: '',
  tenantId: null,
  delete: async () => {},
  getIdToken: async () => 'e2e-mock-id-token',
  getIdTokenResult: async () => e2eIdTokenResult(),
  reload: async () => {},
  toJSON: () => ({}),
  phoneNumber: null,
  photoURL: null,
  providerId: 'firebase',
};

/**
 * Mock authenticated client auth + server credits for prep mode e2e.
 * No live Firebase sign-in or AI calls.
 */
export async function installAuthenticatedPrepFixture(
  context: BrowserContext,
  entitlement: E2EPrepEntitlement = {
    isAdmin: false,
    isBYOK: false,
    credits: 7,
    monthlyFree: 10,
  },
) {
  await context.addCookies([
    {
      name: E2E_CREDITS_COOKIE,
      value: encodeURIComponent(JSON.stringify(entitlement)),
      domain: 'localhost',
      path: '/',
    },
  ]);

  await context.addInitScript((mockUser) => {
    (window as Window & { __INTERVU_E2E_AUTH__?: typeof mockUser }).__INTERVU_E2E_AUTH__ =
      mockUser;
  }, E2E_MOCK_USER);
}

/** Navigate setup → mode for a fresh prep flow. */
export async function openPrepModeScreen(
  page: Page,
  company: string,
  position: string,
  round: string,
) {
  // Portal redesign flip: interview prep lives at /prep, root `/` is now the
  // jobs page (jobs-first-bloom PR1, "prep at /prep").
  await page.goto('/prep');
  await page.waitForLoadState('networkidle');

  await page.getByTestId('prep-start-new').click();
  await page.getByLabel('Company').fill(company);
  await page.getByLabel('Role').fill(position);
  await page.getByLabel('Interview round').fill(round);
  await page.getByRole('button', { name: 'Continue to mode selection' }).click();

  await page.getByTestId('prep-mode-learn').waitFor({ state: 'visible' });
}

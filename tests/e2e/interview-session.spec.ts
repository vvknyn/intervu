import { test, expect, type Page } from '@playwright/test';
import {
  installAuthenticatedPrepFixture,
  openPrepModeScreen,
} from './helpers/prep-auth-fixture';

const FIXTURE_COMPANY = 'TestCo';
const FIXTURE_POSITION = 'Engineer';
const FIXTURE_ROUND = 'Technical';

/** Mirrors InterviewCache.getCacheKey so fixtures match runtime lookups. */
function getCacheKey(company: string, position: string, round: string): string {
  const normalized = `${company.toLowerCase()}_${position.toLowerCase()}_${round.toLowerCase()}`;
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `${Math.abs(hash).toString(36)}_${normalized.substring(0, 20)}`;
}

const FIXTURE_CACHE_KEY = getCacheKey(FIXTURE_COMPANY, FIXTURE_POSITION, FIXTURE_ROUND);

const FIXTURE_PLAN = {
  cacheKey: FIXTURE_CACHE_KEY,
  company: FIXTURE_COMPANY,
  position: FIXTURE_POSITION,
  round: FIXTURE_ROUND,
  hasResumeContext: false,
  createdAt: Date.now(),
  expiresAt: Date.now() + 86400000,
  questionsData: {
    questions: [
      { id: 'q1', question: 'Tell me about yourself', category: 'Behavioral' },
      { id: 'q2', question: 'Why TestCo?', category: 'Behavioral' },
    ],
  },
};

type SessionFixture = {
  version: 1;
  planCacheKey: string;
  mode: 'learn' | 'practice';
  startedAt: string;
  updatedAt: string;
  currentIndex: number;
  questionIds: string[];
  questions: Record<string, {
    questionId: string;
    status: string;
    starred: boolean;
    revealedContent?: string;
  }>;
};

function buildSessionFixture(overrides: Partial<SessionFixture> = {}): SessionFixture {
  const now = Date.now();
  const iso = new Date(now).toISOString();
  return {
    version: 1,
    planCacheKey: FIXTURE_CACHE_KEY,
    mode: 'learn',
    startedAt: iso,
    updatedAt: iso,
    currentIndex: 0,
    questionIds: ['q1', 'q2'],
    questions: {
      q1: { questionId: 'q1', status: 'unreviewed', starred: false },
      q2: { questionId: 'q2', status: 'unreviewed', starred: false },
    },
    ...overrides,
  };
}

async function injectPlanAndSession(
  page: Page,
  sessionOverrides: Partial<SessionFixture> = {},
) {
  const plan = {
    ...FIXTURE_PLAN,
    createdAt: Date.now(),
    expiresAt: Date.now() + 86400000,
  };
  const session = buildSessionFixture(sessionOverrides);

  await page.evaluate(({ planEntry, sessionEntry, cacheKey }) => {
    localStorage.setItem('interview_prep_cache', JSON.stringify({
      [cacheKey]: planEntry,
    }));
    localStorage.setItem(`intervu_prep_session_v1_${cacheKey}`, JSON.stringify(sessionEntry));
  }, { planEntry: plan, sessionEntry: session, cacheKey: FIXTURE_CACHE_KEY });
}

function sessionStorageKey(): string {
  return `intervu_prep_session_v1_${FIXTURE_CACHE_KEY}`;
}

async function readStoredSession(page: Page): Promise<SessionFixture | null> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, sessionStorageKey());
}

async function openLegacyPackageView(page: Page) {
  const params = new URLSearchParams({
    company: FIXTURE_COMPANY,
    position: FIXTURE_POSITION,
    round: FIXTURE_ROUND,
    searched: 'true',
  });
  // Portal redesign flip: prep lives at /prep now, not root (see openPrepModeScreen).
  await page.goto(`/prep?${params.toString()}`);
  await page.waitForLoadState('networkidle');
}

/**
 * TEST GROUP: SESSION - Interview session-first P0 acceptance
 */
test.describe('SESSION - Interview Session P0', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  });

  /**
   * TC-SESSION-001: Landing shows Start and setup → mode flow
   */
  test('TC-SESSION-001: landing shows Start', async ({ page }) => {
    await page.goto('/prep');
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('prep-start-new')).toBeVisible();
    // Portal redesign spec ("Page: Interview prep") renamed the CTA copy.
    await expect(page.getByRole('button', { name: 'Start session' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Search plans' })).toBeVisible();
    // No generic "Resume recent session" affordance anymore — the Recent
    // sessions card only renders (per real session) once one actually
    // exists (spec §"Page: Interview prep", no invented data); this test
    // starts from a clean localStorage, so there's nothing to resume yet.

    await page.getByTestId('prep-start-new').click();
    await expect(page.getByText('Role details')).toBeVisible();
    await expect(page.getByLabel('Company')).toBeVisible();

    await page.getByLabel('Company').fill(FIXTURE_COMPANY);
    await page.getByLabel('Role').fill(FIXTURE_POSITION);
    await page.getByLabel('Interview round').fill(FIXTURE_ROUND);
    await page.getByRole('button', { name: 'Continue to mode selection' }).click();

    await expect(page.getByTestId('prep-mode-learn')).toBeVisible();
    await expect(page.getByTestId('prep-mode-practice')).toBeVisible();
    await expect(page.getByTestId('prep-sign-in-prompt')).toBeVisible();
  });

  /**
   * TC-SESSION-005: Authenticated user sees entitlement on mode screen
   */
  test('TC-SESSION-005: authenticated mode shows entitlement label', async ({ page, context }) => {
    await installAuthenticatedPrepFixture(context, {
      isAdmin: false,
      isBYOK: false,
      credits: 7,
      monthlyFree: 10,
    });

    await openPrepModeScreen(page, FIXTURE_COMPANY, FIXTURE_POSITION, FIXTURE_ROUND);

    await expect(page.getByTestId('prep-entitlement-label')).toHaveText('7 credits');
    await expect(page.getByTestId('prep-sign-in-prompt')).not.toBeVisible();
    await expect(page.getByTestId('prep-mode-learn')).toBeVisible();
    await expect(page.getByTestId('prep-mode-practice')).toBeVisible();
  });

  /**
   * TC-SESSION-006: BYOK entitlement label on mode screen
   */
  test('TC-SESSION-006: authenticated BYOK shows API key entitlement', async ({ page, context }) => {
    await installAuthenticatedPrepFixture(context, {
      isAdmin: false,
      isBYOK: true,
      credits: 0,
      monthlyFree: 10,
    });

    await openPrepModeScreen(page, FIXTURE_COMPANY, FIXTURE_POSITION, FIXTURE_ROUND);

    await expect(page.getByTestId('prep-entitlement-label')).toHaveText('Your API key');
    await expect(page.getByTestId('prep-sign-in-prompt')).not.toBeVisible();
  });

  /**
   * TC-SESSION-007: Admin unlimited entitlement on mode screen
   */
  test('TC-SESSION-007: authenticated admin shows unlimited entitlement', async ({ page, context }) => {
    await installAuthenticatedPrepFixture(context, {
      isAdmin: true,
      isBYOK: false,
      credits: 0,
      monthlyFree: 10,
    });

    await openPrepModeScreen(page, FIXTURE_COMPANY, FIXTURE_POSITION, FIXTURE_ROUND);

    await expect(page.getByTestId('prep-entitlement-label')).toHaveText('Unlimited');
    await expect(page.getByTestId('prep-sign-in-prompt')).not.toBeVisible();
  });

  /**
   * TC-SESSION-002: Fixture plan + session restore shows counter
   */
  test('TC-SESSION-002: fixture plan + session restore shows counter', async ({ page }) => {
    await injectPlanAndSession(page);

    await page.goto('/prep');
    await page.waitForLoadState('networkidle');

    // Recent sessions card renders one real row per cached session (spec:
    // no generic "Resume recent session" affordance).
    await page.getByTestId('prep-recent-session-row').click();

    await expect(page.getByTestId('prep-session-question-counter')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('prep-session-question-counter')).toHaveText('Question 1 of 2');
  });

  /**
   * TC-SESSION-003: Summary progress labels
   */
  test('TC-SESSION-003: summary progress labels', async ({ page }) => {
    await injectPlanAndSession(page, {
      currentIndex: 1,
      questions: {
        q1: {
          questionId: 'q1',
          status: 'reviewed',
          starred: true,
          revealedContent: '<p>Answer one</p>',
        },
        q2: {
          questionId: 'q2',
          status: 'revealed',
          starred: false,
          revealedContent: '<p>Answer two</p>',
        },
      },
    });

    await page.goto('/prep');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('prep-recent-session-row').click();

    await expect(page.getByTestId('prep-session-question-counter')).toHaveText('Question 2 of 2', {
      timeout: 10000,
    });

    await page.getByRole('button', { name: 'I understand' }).click();

    await expect(page.getByTestId('prep-summary-progress')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Progress')).toBeVisible();
    await expect(page.getByText('Reviewed', { exact: true })).toBeVisible();
    await expect(page.getByText('Revealed', { exact: true })).toBeVisible();
    await expect(page.getByText('Practiced', { exact: true })).toBeVisible();
    await expect(page.getByText('Starred', { exact: true })).toBeVisible();
    await expect(page.getByText('Unreviewed', { exact: true })).toBeVisible();
    await expect(page.getByTestId('prep-summary-performance')).not.toBeVisible();
  });

  /**
   * TC-SESSION-004: Switch package → session preserves localStorage session key
   */
  test('TC-SESSION-004: switch package → session preserves localStorage session key', async ({ page }) => {
    await injectPlanAndSession(page, { currentIndex: 1 });

    await openLegacyPackageView(page);

    await expect(page.getByTestId('prep-view-switch')).toBeVisible({ timeout: 10000 });

    const beforeSwitch = await readStoredSession(page);
    expect(beforeSwitch?.currentIndex).toBe(1);

    await page.getByRole('tab', { name: 'Session' }).click();
    await expect(page.getByTestId('prep-session-question-counter')).toHaveText('Question 2 of 2', {
      timeout: 10000,
    });

    await page.getByRole('tab', { name: 'Prep package' }).click();
    await expect(page.locator('[data-tour="search-input"]')).toBeVisible({ timeout: 10000 });

    await page.getByRole('tab', { name: 'Session' }).click();
    await expect(page.getByTestId('prep-session-question-counter')).toHaveText('Question 2 of 2');

    const afterSwitch = await readStoredSession(page);
    expect(afterSwitch).not.toBeNull();
    expect(afterSwitch?.planCacheKey).toBe(FIXTURE_CACHE_KEY);
    expect(afterSwitch?.currentIndex).toBe(1);
    expect(afterSwitch?.questionIds).toEqual(['q1', 'q2']);
  });
});

import { expect, type Locator, type Page } from '@playwright/test';

/** Concept A poster on signed-out /jobs — sits above TopBar; prefer this when visible. */
export const CONCEPT_A_SIGN_IN_TEST_ID = 'concept-a-sign-in';

/**
 * Visible Sign in for signed-out flows — never clicks through the landing poster
 * overlay to reach obscured TopBar chrome.
 */
export async function visibleSignInLocator(page: Page): Promise<Locator> {
  const poster = page.getByTestId(CONCEPT_A_SIGN_IN_TEST_ID);
  if (await poster.isVisible().catch(() => false)) {
    return poster;
  }
  return page.getByTestId('topbar-signin');
}

export async function clickVisibleSignIn(page: Page): Promise<void> {
  const trigger = await visibleSignInLocator(page);
  await expect(trigger).toBeVisible();
  await trigger.click();
}

/** Non-lean marketing routes — TopBar ghost Sign in + green Create account. */
export function marketingTopBarSignIn(page: Page): Locator {
  return page.getByTestId('topbar-signin');
}

export function marketingTopBarCreateAccount(page: Page): Locator {
  return page.getByTestId('topbar-create-account');
}

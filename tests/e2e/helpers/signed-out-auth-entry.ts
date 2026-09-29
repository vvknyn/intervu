import { expect, type Locator, type Page } from '@playwright/test';

/** Signed-out Sign in: the TopBar control (/jobs is board-first, there is no poster above it). */
export async function visibleSignInLocator(page: Page): Promise<Locator> {
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

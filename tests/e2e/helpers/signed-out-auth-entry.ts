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

/** Non-lean marketing routes — TopBar ghost Sign in (Create account is a tab inside the dialog). */
export function marketingTopBarSignIn(page: Page): Locator {
  return page.getByTestId('topbar-signin');
}

/** Opens the auth dialog on the signup tab via Sign in → Create account tab. */
export async function openHeaderSignupTab(page: Page): Promise<void> {
  await clickVisibleSignIn(page);
  const dialog = page.getByRole('dialog').filter({ has: page.getByTestId('auth-submit-button') });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('tab', { name: 'Create account' }).click();
}

/**
 * When to offer anonymous weekly search alerts on /jobs — signed-out only,
 * with a cooldown after dismiss or submit. Pure policy + browser storage
 * helpers, same split as `email-nudge.ts` / `onboarding-prompt.ts`.
 */
import { readBrowserValue, writeBrowserValue } from "./browser-storage";

export const SHOW_AFTER_INTERACTIONS = 2;
export const DISMISS_KEY = "intervu.jobs.searchAlert.dismissed";
export const SUBMITTED_KEY = "intervu.jobs.searchAlert.submitted";
export const COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

export interface SearchAlertCaptureInput {
  signedIn: boolean;
  dismissed: boolean;
  submitted: boolean;
  interactions: number;
  hasResults: boolean;
  authGateVisible?: boolean;
}

export function shouldShowSearchAlertCapture(input: SearchAlertCaptureInput): boolean {
  if (input.authGateVisible) return false;
  if (input.signedIn) return false;
  if (input.dismissed || input.submitted) return false;
  if (!input.hasResults) return true;
  return input.interactions >= SHOW_AFTER_INTERACTIONS;
}

function isWithinCooldown(raw: string | null, now = Date.now()): boolean {
  if (!raw) return false;
  const at = Date.parse(raw);
  if (Number.isNaN(at)) return raw === "true";
  return now - at < COOLDOWN_MS;
}

export function isSearchAlertDismissed(now = Date.now()): boolean {
  return isWithinCooldown(readBrowserValue(DISMISS_KEY), now);
}

export function isSearchAlertSubmitted(now = Date.now()): boolean {
  return isWithinCooldown(readBrowserValue(SUBMITTED_KEY), now);
}

export function dismissSearchAlertCapture(now = Date.now()): void {
  writeBrowserValue(DISMISS_KEY, new Date(now).toISOString());
}

export function markSearchAlertSubmitted(now = Date.now()): void {
  writeBrowserValue(SUBMITTED_KEY, new Date(now).toISOString());
}

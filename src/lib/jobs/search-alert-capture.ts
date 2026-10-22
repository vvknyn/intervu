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
  /** When search is down or unconfigured, alert capture must not show. */
  searchUnhealthy?: boolean;
}

export function shouldShowSearchAlertCapture(input: SearchAlertCaptureInput): boolean {
  if (input.searchUnhealthy) return false;
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

/**
 * The searches this browser asked to be emailed about, by `savedSearchId`, so
 * a guest's alerts switch still reads "on" for that search after a reload.
 * The alert itself lives on the server under the email address; this is only
 * the switch's memory, so a cleared browser shows it off again.
 */
export const REQUESTED_KEY = "intervu.jobs.searchAlert.requested";
const MAX_REQUESTED = 20;

export function readRequestedSearchAlerts(): string[] {
  try {
    const parsed: unknown = JSON.parse(readBrowserValue(REQUESTED_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function markSearchAlertRequested(searchId: string): void {
  const kept = readRequestedSearchAlerts().filter((id) => id !== searchId);
  writeBrowserValue(REQUESTED_KEY, JSON.stringify([searchId, ...kept].slice(0, MAX_REQUESTED)));
}

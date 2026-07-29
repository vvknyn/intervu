export const FOLLOW_ALERT_CURSOR_KEY = "intervu.follows.alertCursor";

const DEFAULT_LOOKBACK_MS = 7 * 86_400_000;

export function defaultFollowAlertCursor(nowMs = Date.now()): string {
  return new Date(nowMs - DEFAULT_LOOKBACK_MS).toISOString();
}

export function readFollowAlertCursor(): string {
  if (typeof window === "undefined") return defaultFollowAlertCursor();
  try {
    const raw = localStorage.getItem(FOLLOW_ALERT_CURSOR_KEY);
    if (raw && !Number.isNaN(Date.parse(raw))) return raw;
  } catch {
    /* private mode / SSR */
  }
  return defaultFollowAlertCursor();
}

export function writeFollowAlertCursor(iso: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(FOLLOW_ALERT_CURSOR_KEY, iso);
  } catch {
    /* quota exceeded */
  }
}

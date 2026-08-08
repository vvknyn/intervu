/**
 * Thin re-export of the "follows" `visit-cursor.ts` scope. Kept as its own
 * module (rather than inlining callers onto visit-cursor.ts directly) so
 * `FollowAlertsCard` and any other existing consumer keep compiling against
 * these exact names, and so the legacy `intervu.follows.alertCursor`
 * storage key stays exactly where readers already look for it.
 */
import { defaultVisitCursor, readVisitCursor, writeVisitCursor } from "@/lib/jobs/visit-cursor";

export const FOLLOW_ALERT_CURSOR_KEY = "intervu.follows.alertCursor";

export function defaultFollowAlertCursor(nowMs = Date.now()): string {
  return defaultVisitCursor(nowMs);
}

export function readFollowAlertCursor(): string {
  return readVisitCursor("follows");
}

export function writeFollowAlertCursor(iso: string): void {
  writeVisitCursor("follows", iso);
}

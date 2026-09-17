/**
 * Cap on auth popovers the product opens on its own — a gated action
 * redirecting to sign-in (guest Apply, a second guest Save, ...) — as
 * opposed to a popover the user opened themselves by clicking Sign In.
 * Every `trigger=auto` open checks `canShowAutoNudge` first (pure, safe
 * to call on every render); a decision to actually show it then calls
 * `markAutoNudgeShown` once (see nudge-gate.ts, which sequences the two
 * on the open transition rather than on every render). A "not now" on a
 * shown nudge calls `recordNudgeDismissed`. Same defensive idiom as
 * `guest-engage-nudge.ts` (try/catch, `typeof window` guard): storage
 * throwing (private mode) means "don't nudge" — the gated action itself
 * (e.g. the ATS tab already opened) is unaffected either way, only the
 * extra popover on top of it.
 *
 * `now` is a parameter rather than an internal `Date.now()` call — same
 * idiom `takePersistedPendingAction` (pending-actions.ts) uses — so the
 * 7-day suppression window is testable with a fake clock.
 */

import type { AuthGateReason } from "@/lib/auth/auth-gate-copy";

const SESSION_SHOWN_PREFIX = "intervu.authNudge.shown.";
const DISMISSED_UNTIL_PREFIX = "intervu.authNudge.dismissedUntil.";
const SUPPRESS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * True at most once per session per reason, and never within 7 days of a
 * "not now" for that reason. Pure read — no side effect — so it is safe
 * to call on every render. Call `markAutoNudgeShown` separately, once,
 * when a caller actually decides to show the nudge.
 */
export function canShowAutoNudge(reason: AuthGateReason, now = Date.now()): boolean {
    try {
        if (typeof window === "undefined") return false;
        const session = window.sessionStorage;
        const local = window.localStorage;
        if (session.getItem(SESSION_SHOWN_PREFIX + reason) === "true") return false;
        const dismissedUntil = Number(local.getItem(DISMISSED_UNTIL_PREFIX + reason) ?? "0");
        if (dismissedUntil > now) return false;
        return true;
    } catch {
        return false;
    }
}

/**
 * Records that `reason` was shown this session, so a later gated action
 * with the same reason in the same session doesn't re-nudge.
 */
export function markAutoNudgeShown(reason: AuthGateReason): void {
    try {
        window.sessionStorage.setItem(SESSION_SHOWN_PREFIX + reason, "true");
    } catch {
        /* quota exceeded / private mode */
    }
}

/** "Not now" on an auto-shown nudge — suppress that reason for 7 days. */
export function recordNudgeDismissed(reason: AuthGateReason, now = Date.now()): void {
    try {
        window.localStorage.setItem(DISMISSED_UNTIL_PREFIX + reason, String(now + SUPPRESS_MS));
    } catch {
        /* quota exceeded / private mode */
    }
}

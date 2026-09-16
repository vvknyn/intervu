/**
 * Auth popover value lines — one helper keyed by reason class (apply |
 * generic), not by button name. When the guest pursuit store has a real count,
 * prepends an honest keep-line; never fabricates a count.
 */

export type AuthGateReason = "apply" | "generic" | "save" | "fit" | "report" | "tailor" | "resume";

/** Pure guard for auth_started — fire only on false→true, not on close or
 *  re-renders while open. Kept next to AuthGateReason so AuthPopover and
 *  tests share one rule without mounting the modal. */
export function shouldCaptureAuthStarted(wasOpen: boolean, nowOpen: boolean): boolean {
    return !wasOpen && nowOpen;
}

export const GUEST_SAVE_TOAST = "Saved — find it in your Tracker";

/** Shown on LoginForm's own signup-tab header, on every AuthPopover surface
 *  site-wide (header CTA, apply-gate, follow flow, /login) — one string, not
 *  a per-surface fork, so the value promise can't drift between them
 *  (wave-2 value-first signup ladder, 2026-08-20: was "Save roles and track
 *  where you've applied", broadened to name the alerts/tracker triad the
 *  header's new "Get job alerts" CTA is selling). */
export const SIGNUP_SUBCOPY = "Get job alerts, saved searches, and an application tracker — on any device.";

const AUTH_GATE_LEAD: Record<AuthGateReason, string> = {
    apply: "Create a free account to track this application across devices.",
    generic: "Sign in to sync your tracker across devices.",
    save: "Sign in to keep your list across devices and get alerts when new roles match.",
    fit: "Sign in to match roles to your résumé and get personalized recommendations.",
    report: "Sign in to report an issue with this listing.",
    tailor: "Create a free account to tailor your résumé with on-device AI and export customized applications.",
    resume: "Create a free account to edit, export, and sync your résumé across devices.",
};

/** Honest keep-line when guest pursuits exist; null when count is zero. */
export function guestKeepLine(guestPursuitCount: number): string | null {
    if (guestPursuitCount <= 0) return null;
    return guestPursuitCount === 1
        ? "We'll keep the role you've saved on this device."
        : `We'll keep the ${guestPursuitCount} roles you've saved on this device.`;
}

/** Value line for AuthPopover — reason class + optional honest guest count. */
export function formatAuthGateValueLine(reason: AuthGateReason, guestPursuitCount = 0): string {
    const keep = guestKeepLine(guestPursuitCount);
    const lead = AUTH_GATE_LEAD[reason];
    return keep ? `${keep} ${lead}` : lead;
}

export type AuthCardTab = "login" | "signup";

export interface AuthCardCopy {
    title: string;
    tabLabel: string;
    submitLabel: string;
}

/** Single source of truth for LoginForm's per-tab wording. The tab label,
 *  card heading, and submit button all have to name the same action
 *  (control-names-the-action) — deriving all three from one `label` instead
 *  of three call sites each picking their own string is what makes them
 *  incapable of drifting apart. */
export function authCardCopy(tab: AuthCardTab): AuthCardCopy {
    const label = tab === "signup" ? "Create account" : "Sign in";
    return {
        title: label,
        tabLabel: label,
        submitLabel: label,
    };
}

/** Exported guest-surface strings for jargon guard tests. */
export const GUEST_AUTH_STRINGS: Record<string, string> = {
    SAVE_TOAST: GUEST_SAVE_TOAST,
    SIGNUP_SUBCOPY,
    KEEP_ONE: guestKeepLine(1)!,
    KEEP_TWO: guestKeepLine(2)!,
    APPLY_LINE: formatAuthGateValueLine("apply", 0),
    GENERIC_LINE: formatAuthGateValueLine("generic", 0),
    APPLY_WITH_KEEP: formatAuthGateValueLine("apply", 2),
    FIT_LINE: formatAuthGateValueLine("fit", 0),
    REPORT_LINE: formatAuthGateValueLine("report", 0),
};

/**
 * Auth popover value lines — one helper keyed by reason class (apply |
 * generic), not by button name. When the guest pursuit store has a real count,
 * prepends an honest keep-line; never fabricates a count.
 */

import { ANALYTICS_EVENTS } from "@/lib/analytics/event-names";

export type AuthGateReason = "apply" | "generic" | "save" | "fit" | "report" | "tailor" | "resume";

/** Pure guard for auth_started — fire only on false→true, not on close or
 *  re-renders while open. Kept next to AuthGateReason so AuthPopover and
 *  tests share one rule without mounting the modal. */
export function shouldCaptureAuthStarted(wasOpen: boolean, nowOpen: boolean): boolean {
    return !wasOpen && nowOpen;
}

/** Who opened the popover: "user" clicked a sign-in affordance themselves;
 *  "auto" is the product opening it as a side effect of a gated action
 *  (guest Apply, a second guest Save, ...) — never a click on "Sign In".
 *  Only a real "user" open is a funnel start; an "auto" open is a nudge,
 *  not an attempt, so it gets its own honest event name. Pure mapping,
 *  kept next to AuthGateReason so AuthPopover and tests share one rule. */
export type AuthGateTrigger = "user" | "auto";

export function resolveAuthOpenEvent(
    trigger: AuthGateTrigger,
): typeof ANALYTICS_EVENTS.auth_started | typeof ANALYTICS_EVENTS.auth_nudge_shown {
    return trigger === "user" ? ANALYTICS_EVENTS.auth_started : ANALYTICS_EVENTS.auth_nudge_shown;
}

export const GUEST_SAVE_TOAST = "Saved — find it in your Tracker";

/** Shown on LoginForm's own signup-tab header, on every AuthPopover surface
 *  site-wide (header CTA, apply-gate, follow flow, /login) — one string, not
 *  a per-surface fork, so the value promise can't drift between them
 *  (wave-2 value-first signup ladder, 2026-08-20: was "Save roles and track
 *  where you've applied", broadened to name the alerts/tracker triad the
 *  header's new "Get job alerts" CTA is selling). */
export const SIGNUP_SUBCOPY = "Get job alerts, saved searches, and an application tracker — on any device.";

/** A reason's copy — `body` always renders as the popover's value line.
 *  `title` is optional; when present it REPLACES LoginForm's own generic
 *  heading and subcopy (see login-form.tsx's `headline` prop) rather than
 *  stacking above them — one heading, one explanatory line, not both sets.
 *  Only a reason whose gate is a hard stop before the user can act (apply)
 *  needs one; the rest keep the plain "Sign in"/"Create account" card
 *  heading with `body` rendered separately above the card (auth-popover.tsx). */
interface AuthGateCopy {
    title?: string;
    body: string;
}

const AUTH_GATE_COPY: Record<AuthGateReason, AuthGateCopy> = {
    // 2026-09-18 apply-behind-signup: the guest never reaches the ATS before
    // this popover, so the title has to say what's about to happen, not just
    // sell the account.
    apply: {
        title: "Create a free account to apply",
        body: "We'll take you to the company's application page next, and track this application across your devices.",
    },
    generic: { body: "Sign in to sync your tracker across devices." },
    save: { body: "Sign in to keep your list across devices and get alerts when new roles match." },
    // Only-facts copy (Fable design pass, 2026-09-17): no "personalized
    // recommendations" claim and no on-device claim — fit scoring's
    // client-vs-server split (src/lib/match/score.ts,
    // src/lib/local-ai/tailor-with-engine.ts) isn't something the user needs
    // to know to decide whether to sign in, so it's not asserted here.
    fit: { body: "Sign in to upload your résumé and rank every result by fit." },
    report: { body: "Sign in to report an issue with this listing." },
    tailor: {
        body: "Create a free account to tailor your résumé with on-device AI and export customized applications.",
    },
    resume: { body: "Create a free account to edit, export, and sync your résumé across devices." },
};

/** Visible card heading for reasons that need one, replacing LoginForm's
 *  generic per-tab heading; undefined otherwise (LoginForm falls back to
 *  its normal `authCardCopy` heading). */
export function authGateTitle(reason: AuthGateReason): string | undefined {
    return AUTH_GATE_COPY[reason].title;
}

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
    const lead = AUTH_GATE_COPY[reason].body;
    return keep ? `${keep} ${lead}` : lead;
}

/** Canonical label for every sign-in control site-wide — control-names-the-
 *  action, single spelling so it cannot drift per surface (reviewer round 1
 *  fix-up, 2026-09-17: two sites had drifted to "Log In"). */
export const AUTH_CTA_LABEL = "Sign in";

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
    const label = tab === "signup" ? "Create account" : AUTH_CTA_LABEL;
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

/**
 * Auth popover value lines — one helper keyed by reason class, not by button name.
 */

import { ANALYTICS_EVENTS } from "@/lib/analytics/event-names";
import { AUTH_GATE_RESUME_UNLOCK_BODY } from "@/lib/jobs/resume-privacy-copy";

export type AuthGateReason =
    | "apply"
    | "generic"
    | "save"
    | "fit"
    | "report"
    | "tailor"
    | "resume"
    | "tracker"
    | "alert"
    | "topbar";

/** Pure guard for auth_started — fire only on false→true, not on close or re-renders while open. */
export function shouldCaptureAuthStarted(wasOpen: boolean, nowOpen: boolean): boolean {
    return !wasOpen && nowOpen;
}

/** Who opened the popover: explicit user click vs passive product prompt. */
export type AuthGateTrigger = "user" | "auto";

export function resolveAuthOpenEvent(
    trigger: AuthGateTrigger,
): typeof ANALYTICS_EVENTS.auth_started | typeof ANALYTICS_EVENTS.auth_nudge_shown {
    return trigger === "user" ? ANALYTICS_EVENTS.auth_started : ANALYTICS_EVENTS.auth_nudge_shown;
}

export const GUEST_SAVE_TOAST = "Saved — find it in your Tracker";

export const SIGNUP_SUBCOPY =
    "Get job alerts, saved searches, and an application tracker — on any device.";

interface AuthGateCopy {
    title?: string;
    body: string;
}

const AUTH_GATE_COPY: Record<AuthGateReason, AuthGateCopy> = {
    apply: {
        title: "Sign in to track this application",
        body: "Your saved jobs and application stages will sync across devices.",
    },
    generic: { body: "Sign in to sync your tracker across devices." },
    topbar: { body: "Sign in to sync your tracker across devices." },
    save: {
        title: "Sign in to save this job to Tracker.",
        body: "Your saved jobs and application stages will sync across devices.",
    },
    fit: {
        title: "Create your free account, then upload your résumé.",
        body: AUTH_GATE_RESUME_UNLOCK_BODY,
    },
    report: { body: "Sign in to report an issue with this listing." },
    tailor: {
        body: "Sign in to sync this tailored version across devices.",
    },
    resume: {
        title: "Create your free account, then upload your résumé.",
        body: AUTH_GATE_RESUME_UNLOCK_BODY,
    },
    tracker: {
        title: "Sign in to track this application",
        body: "Your saved jobs and application stages will sync across devices.",
    },
    alert: { body: "Sign in to save this search and get alerts when new roles match." },
};

export function authGateTitle(reason: AuthGateReason): string | undefined {
    return AUTH_GATE_COPY[reason].title;
}

export function guestKeepLine(guestPursuitCount: number): string | null {
    if (guestPursuitCount <= 0) return null;
    return guestPursuitCount === 1
        ? "We'll keep the role you've saved on this device."
        : `We'll keep the ${guestPursuitCount} roles you've saved on this device.`;
}

export function formatAuthGateValueLine(reason: AuthGateReason, guestPursuitCount = 0): string {
    const keep = guestKeepLine(guestPursuitCount);
    const lead = AUTH_GATE_COPY[reason].body;
    return keep ? `${keep} ${lead}` : lead;
}

export const AUTH_CTA_LABEL = "Sign in";

export type AuthCardTab = "login" | "signup";

export interface AuthCardCopy {
    title: string;
    tabLabel: string;
    submitLabel: string;
}

export function authCardCopy(tab: AuthCardTab): AuthCardCopy {
    const label = tab === "signup" ? "Create account" : AUTH_CTA_LABEL;
    return {
        title: label,
        tabLabel: label,
        submitLabel: label,
    };
}

/** Upload CTA when auth is the next step (not the importer). */
export const RESUME_UPLOAD_AUTH_CTA = "Create account & upload résumé";

/** Upload CTA when the importer opens next. */
export const RESUME_UPLOAD_CTA = "Upload résumé";

export const GUEST_AUTH_STRINGS: Record<string, string> = {
    SAVE_TOAST: GUEST_SAVE_TOAST,
    SIGNUP_SUBCOPY,
    KEEP_ONE: guestKeepLine(1)!,
    KEEP_TWO: guestKeepLine(2)!,
    GENERIC_LINE: formatAuthGateValueLine("generic", 0),
    SAVE_LINE: formatAuthGateValueLine("save", 0),
    FIT_LINE: formatAuthGateValueLine("fit", 0),
    FIT_TITLE: authGateTitle("fit")!,
    SAVE_TITLE: authGateTitle("save")!,
    TAILOR_LINE: formatAuthGateValueLine("tailor", 0),
    REPORT_LINE: formatAuthGateValueLine("report", 0),
};

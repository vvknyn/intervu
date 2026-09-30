/**
 * Auth popover value lines — one helper keyed by reason class, not by button name.
 */

import { ANALYTICS_EVENTS } from "@/lib/analytics/event-names";
import { formatCorpusCount, type CorpusCount } from "@/lib/jobs/corpus-count";
import { AUTH_GATE_RESUME_UNLOCK_BODY } from "@/lib/jobs/resume-privacy-copy";

export type AuthGateReason =
    | "apply"
    | "generic"
    | "save"
    | "fit"
    | "tailor"
    | "resume"
    | "tracker"
    | "alert"
    | "depth"
    | "follow"
    | "topbar";

/** Who opened the popover: explicit user click vs passive product prompt. */
export type AuthGateTrigger = "user" | "auto";

/**
 * Event for the gate opening, if any.
 * An auto prompt fires `auth_nudge_shown`. A user opening the modal or
 * `/login` fires nothing here. `auth_started` waits for method engagement
 * in `login-form.tsx` (Google, username submit, passkey or email code).
 */
export function resolveAuthOpenEvent(
    trigger: AuthGateTrigger,
): typeof ANALYTICS_EVENTS.auth_nudge_shown | null {
    return trigger === "auto" ? ANALYTICS_EVENTS.auth_nudge_shown : null;
}

export const GUEST_SAVE_TOAST = "Saved — find it in your Tracker";

export const SIGNUP_SUBCOPY =
    "Get job alerts, saved searches, and an application tracker — on any device.";

/**
 * Fit and résumé sign-in cards open both before and after a guest uploads, so
 * their copy must be true in both states: it never asks for a résumé the
 * visitor already gave, and never claims one was read when none was.
 */
const RESUME_GATE_TITLE = "Create your free account to rank every job by your résumé.";

/** Under the unlock line on fit and résumé sign-in cards. */
export const AUTH_GATE_RESUME_ACCOUNT_LINE =
    "Your résumé is read in this browser. Signing in keeps the structured version with your account, not the original file, including one you already added.";

const FIT_RESUME_GATE_BODY = `${AUTH_GATE_RESUME_UNLOCK_BODY}\n\n${AUTH_GATE_RESUME_ACCOUNT_LINE}`;

interface AuthGateCopy {
    title?: string;
    body: string;
    /** Names the attempted action — the `SignupGate` card headline. Falls back to `title`. */
    action?: string;
    /** Card headline when the gate can quote a true count (hidden remainder or total matches) (already formatted, "N" or "N+"). */
    actionWithCount?: (count: string) => string;
}

const AUTH_GATE_COPY: Record<AuthGateReason, AuthGateCopy> = {
    apply: {
        title: "Sign in to apply",
        body: "Create a free account to open the employer posting and keep your applications in one place.",
    },
    generic: { body: "Sign in to sync your tracker across devices." },
    topbar: { body: "Sign in to sync your tracker across devices." },
    save: {
        title: "Sign in to save this job to Tracker.",
        action: "Keep your saved roles on every device",
        body: "Your saved jobs and application stages will sync across devices.",
    },
    fit: {
        title: RESUME_GATE_TITLE,
        action: "See all your ranked matches",
        actionWithCount: (count) => `See all ${count} matches ranked for you`,
        body: FIT_RESUME_GATE_BODY,
    },
    tailor: {
        body: "Sign in to sync this tailored version across devices.",
    },
    resume: {
        title: RESUME_GATE_TITLE,
        body: FIT_RESUME_GATE_BODY,
    },
    tracker: {
        title: "Sign in to track this application",
        action: "See the roles you've applied to and viewed",
        body: "Your saved jobs and application stages will sync across devices.",
    },
    alert: {
        action: "Save this search",
        body: "A free account keeps this search and emails you when new roles match.",
    },
    follow: { body: "Sign in to keep the companies you follow across devices." },
    depth: {
        action: "See every result",
        actionWithCount: (hidden) => `See the other ${hidden} roles that match`,
        body: "It's free, and it also gets you saved searches and email alerts.",
    },
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

export const SIGNUP_GATE_CREATE_LABEL = "Create free account";

export interface SignupGateCopy {
    title: string;
    body: string;
    createLabel: string;
    signInLabel: string;
}

/**
 * Copy for the one signed-out gate card (`SignupGate`): names the attempted
 * action, says what the account gives, and quotes a hidden count only when the
 * caller holds a true one — a floor renders "N+", never a bare number.
 */
export function signupGateCopy(reason: AuthGateReason, count?: CorpusCount | null): SignupGateCopy {
    const entry = AUTH_GATE_COPY[reason];
    const title =
        count && entry.actionWithCount
            ? entry.actionWithCount(formatCorpusCount(count))
            : (entry.action ?? entry.title ?? "Create your free account");
    return { title, body: entry.body, createLabel: SIGNUP_GATE_CREATE_LABEL, signInLabel: AUTH_CTA_LABEL };
}

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

/** Upload CTA — the importer opens next; uploading needs no account. */
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
};

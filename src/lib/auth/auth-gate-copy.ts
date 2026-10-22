/**
 * Auth popover value lines — one helper keyed by reason class, not by button name.
 */

import { ANALYTICS_EVENTS } from "@/lib/analytics/event-names";
import { formatCorpusCount, type CorpusCount } from "@/lib/jobs/corpus-count";

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
    | "company"
    | "topbar"
    | "packs";

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

/** One gate, one headline and one sentence giving the reason. `titleWithCount` quotes a TRUE count (already formatted, "N" or "N+"). */
interface AuthGateEntry {
    title: string;
    line: string;
    titleWithCount?: (count: string) => string;
}

/**
 * The ONE copy family for every signed-out gate (popover, `SignupGate` card). The fit and résumé
 * cards open both before and after a guest uploads, so their lines are true in both states: they
 * never ask for a résumé the visitor already gave, and never claim one was read when none was.
 */
const AUTH_GATE_COPY: Record<AuthGateReason, AuthGateEntry> = {
    apply: { title: "Sign in to apply", line: "A free account opens the employer posting and keeps your applications in one place." },
    generic: { title: "Sync your tracker across devices", line: "A free account keeps your saved jobs and application stages on every device." },
    topbar: { title: "Join Velai", line: "Get job alerts, saved searches and an application tracker, free on any device." },
    save: { title: "Sign in to save this job", line: "Saved jobs and their stages sync across your devices." },
    tracker: { title: "Sign in to track this application", line: "Your applications and their stages stay in your Tracker on every device." },
    fit: {
        title: "See all your ranked matches",
        titleWithCount: (count) => `See all ${count} matches ranked for you`,
        line: "A free account shows every match ranked by your résumé and keeps its structured version, encrypted.",
    },
    resume: { title: "Rank every job by your résumé", line: "A free account keeps the structured version of your résumé, encrypted, never the original file." },
    packs: { title: "See your job packs", line: "Packs are ranked by your résumé; a free account keeps its structured version, encrypted." },
    tailor: { title: "Sign in to keep this version", line: "A free account syncs your tailored résumé across devices." },
    alert: { title: "Save this search", line: "A free account keeps it and emails you when new roles match." },
    follow: { title: "Follow this company", line: "A free account keeps the companies you follow across devices." },
    company: { title: "Open the full hiring record", line: "It's free: how this employer's postings close and what their hiring runs on, plus alerts and a tracker." },
    depth: {
        title: "See every result",
        titleWithCount: (hidden) => `See the other ${hidden} roles that match`,
        line: "It's free, and it also gets you saved searches and email alerts.",
    },
};

export function authGateCopy(reason: AuthGateReason): { title: string; line: string } {
    const { title, line } = AUTH_GATE_COPY[reason];
    return { title, line };
}

export function guestKeepLine(guestPursuitCount: number): string | null {
    if (guestPursuitCount <= 0) return null;
    return guestPursuitCount === 1
        ? "We'll keep the role you've saved on this device."
        : `We'll keep the ${guestPursuitCount} roles you've saved on this device.`;
}

export function formatAuthGateValueLine(reason: AuthGateReason, guestPursuitCount = 0): string {
    const keep = guestKeepLine(guestPursuitCount);
    const lead = AUTH_GATE_COPY[reason].line;
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

/** `SignupGate` card copy: the gate's headline (quoting a hidden count only when the caller holds a true one; a floor renders "N+") and its one line. */
export function signupGateCopy(reason: AuthGateReason, count?: CorpusCount | null): SignupGateCopy {
    const entry = AUTH_GATE_COPY[reason];
    const title = count && entry.titleWithCount ? entry.titleWithCount(formatCorpusCount(count)) : entry.title;
    return { title, body: entry.line, createLabel: SIGNUP_GATE_CREATE_LABEL, signInLabel: AUTH_CTA_LABEL };
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
    FIT_TITLE: authGateCopy("fit").title,
    SAVE_TITLE: authGateCopy("save").title,
    TAILOR_LINE: formatAuthGateValueLine("tailor", 0),
};

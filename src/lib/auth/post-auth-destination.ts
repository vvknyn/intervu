/**
 * Post-auth landing paths — route signed-in users without a usable résumé
 * into the existing /jobs résumé gate (`/jobs?resume=gate`) so one-shot
 * upload can open. Signup AuthKit returns always use the gate; résumeless
 * password/login landings do too unless a pending apply/upload/report owns
 * the next step.
 */

import type { AuthGateReason } from "@/lib/auth/auth-gate-copy";
import type { ResumeFunnelReason } from "@/lib/analytics/resume-funnel";

/** Query flag consumed by /jobs to auto-open ResumeImportModal once. */
export const POST_AUTH_RESUME_GATE_PARAM = "resume";
export const POST_AUTH_RESUME_GATE_VALUE = "gate";

export function buildPostAuthResumeGatePath(): string {
    return `/jobs?${POST_AUTH_RESUME_GATE_PARAM}=${POST_AUTH_RESUME_GATE_VALUE}`;
}

export function hasPostAuthResumeGateParam(path: string): boolean {
    try {
        const url = new URL(path, "http://localhost");
        return (
            url.pathname === "/jobs" &&
            url.searchParams.get(POST_AUTH_RESUME_GATE_PARAM) === POST_AUTH_RESUME_GATE_VALUE
        );
    } catch {
        return false;
    }
}

/** True when `next` is the anonymous browse default, not a deliberate return target. */
export function isBareJobsDefault(next: string | null | undefined): boolean {
    if (!next) return true;
    const trimmed = next.trim();
    if (trimmed === "/jobs" || trimmed === "/jobs/") return true;
    return hasPostAuthResumeGateParam(trimmed);
}

const AUTH_TO_FUNNEL: Partial<Record<AuthGateReason, ResumeFunnelReason>> = {
    fit: "fit",
    resume: "resume",
    tailor: "tailor",
    apply: "tracker",
    tracker: "tracker",
};

/** Map gate continuity to résumé funnel `reason` for resume_gate_shown. */
export function authGateReasonToFunnelReason(reason?: AuthGateReason | null): ResumeFunnelReason {
    if (!reason) return "fit";
    return AUTH_TO_FUNNEL[reason] ?? "fit";
}

export function resolvePostAuthDestination(input: {
    validatedNext: string | null;
    hasResume: boolean;
    hasPendingAction: boolean;
}): string {
    const { validatedNext, hasResume, hasPendingAction } = input;

    if (hasResume) {
        return validatedNext ?? "/jobs";
    }

    // Pending apply/upload/report replay owns the next step on returnTo.
    if (hasPendingAction) {
        return validatedNext ?? "/jobs";
    }

    // Résumeless with nothing queued: always open the upload gate — including
    // returns from /co/…, Search queries, Settings, or Connect. #585 only
    // covered bare /jobs; company-page signups were skipping the modal.
    return buildPostAuthResumeGatePath();
}

/** Rewrite AuthKit `next` for every signup so WorkOS returns to the résumé gate. */
export function resolveAuthKitReturnTo(input: {
    mode: "login" | "signup";
    rawNext: string | null | undefined;
}): string | null {
    const next = input.rawNext?.trim() ? input.rawNext.trim() : null;
    if (input.mode === "signup") {
        return buildPostAuthResumeGatePath();
    }
    return next;
}

/** Whether inline signup on /jobs should open the post-auth résumé gate. */
export function shouldOpenResumeGateAfterInlineAuth(input: {
    pendingActionKind: string | null;
    alreadyHandled: boolean;
    importAlreadyOpen: boolean;
    hasResume: boolean;
}): boolean {
    if (input.pendingActionKind) return false;
    if (input.alreadyHandled || input.importAlreadyOpen) return false;
    return input.hasResume === false;
}

/** A same-site path. A bare query string (`?q=…`) is not one: `next` would land off `/jobs`. */
export type SitePath = `/${string}`;

/**
 * Hrefs for the two doors a signed-out gate offers — real links, so the gate
 * needs no client state. Both carry the page the visitor was on; `/auth/start`
 * itself rewrites a signup `next` to the résumé gate (`resolveAuthKitReturnTo`).
 */
export function signupGateHrefs(returnTo: SitePath): { create: string; signIn: string } {
    const next = encodeURIComponent(returnTo);
    return { create: `/auth/start?mode=signup&next=${next}`, signIn: `/login?next=${next}` };
}

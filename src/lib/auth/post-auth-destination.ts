/**
 * Post-auth landing paths — route signed-in users without a usable résumé
 * into the existing /jobs résumé gate instead of bare `/jobs`.
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

    // Honor explicit non-default destinations (/settings, /connect, /jobs?q=…).
    if (validatedNext && !isBareJobsDefault(validatedNext)) {
        return validatedNext;
    }

    return buildPostAuthResumeGatePath();
}

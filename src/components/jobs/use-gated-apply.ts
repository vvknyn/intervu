"use client";

import { resolveApplyClickDecision } from "@/lib/jobs/pending-actions";

/**
 * Shared Apply-click handler: every surface opens the employer apply URL
 * immediately — no auth wall before departure. Signed-in users keep
 * apply-intent / tracker behavior via `perform`; guests may receive an
 * optional post-open tracker prompt via `onGuestApplied`.
 */
export function openApplyUrl(url: string): void {
    window.open(url, "_blank", "noopener,noreferrer");
}

export function useGatedApply<Job>({
    user,
    perform,
    onGuestApplied,
}: {
    user: unknown;
    /** @deprecated Apply no longer auth-gates — kept for call-site compatibility. */
    gate?: (action: { kind: "apply"; payload: Job }) => void;
    /** @deprecated Apply no longer sets auth reason — use onGuestApplied. */
    setAuthGateReason?: (reason: unknown) => void;
    setAuthTrigger?: (trigger: unknown) => void;
    perform: (job: Job) => void;
    /** Fired after perform for signed-out users — optional tracker prompt. */
    onGuestApplied?: (job: Job) => void;
}): (job: Job) => void {
    return (job: Job) => {
        if (resolveApplyClickDecision(Boolean(user)) === "perform") {
            perform(job);
            if (!user) onGuestApplied?.(job);
        }
    };
}

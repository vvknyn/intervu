/**
 * Pure helper: record gate continuity then return popover props callers need.
 */

import { beginGateAttempt, type OriginSurface } from "@/lib/auth/gate-attempt";
import type { AuthGateReason, AuthGateTrigger } from "@/lib/auth/auth-gate-copy";
import { buildReturnTo, type PendingActionStorage } from "@/lib/jobs/pending-actions";

export interface OpenAuthGateInput {
    storage: PendingActionStorage;
    reason: AuthGateReason;
    trigger: AuthGateTrigger;
    originSurface: OriginSurface;
    returnTo?: string;
    jobId?: string;
}

export function recordAuthGateOpen(input: OpenAuthGateInput) {
    const attempt = beginGateAttempt(input.storage, {
        reason: input.reason,
        originSurface: input.originSurface,
        returnTo: input.returnTo,
        jobId: input.jobId,
    });
    return attempt;
}

export function defaultReturnTo(location?: Pick<Location, "pathname" | "search" | "hash">): string | undefined {
    if (!location) return undefined;
    return buildReturnTo(location);
}

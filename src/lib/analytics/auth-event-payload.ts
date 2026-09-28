import type { AuthGateReason } from "@/lib/auth/auth-gate-copy";
import {
    gateAttemptEventFields,
    type GateAttempt,
    type GateAttemptEventFields,
    type OriginSurface,
} from "@/lib/auth/gate-attempt";

/** Shared auth funnel properties — reason + gate_reason mirror for dashboards. */
export interface AuthEventContext {
    reason: AuthGateReason;
    gate_reason: AuthGateReason;
    origin_surface?: OriginSurface;
    trigger_type?: "user" | "auto";
    pending_action_id?: string;
    job_id?: string;
    return_to?: string;
    has_resume?: boolean;
    signed_in?: boolean;
    guest_save_count?: number;
}

export interface AuthContinuityFields {
    first_gate_reason?: AuthGateReason;
    last_gate_reason?: AuthGateReason;
    pending_action_id?: string;
    origin_surface?: OriginSurface;
}

export function buildAuthOpenPayload(
    reason: AuthGateReason,
    fields: Partial<Omit<AuthEventContext, "reason" | "gate_reason">> = {},
): AuthEventContext {
    return {
        reason,
        gate_reason: reason,
        ...fields,
    };
}

/**
 * `auth_started` payload at real method engagement.
 * Reason is the in-flight gate attempt, or `fallbackReason` when the user
 * reached a method with nothing stored (login still begins a `"topbar"`
 * attempt before the form mounts, so this fallback is the popover/generic case).
 */
export function authStartedPayloadFromAttempt(
    attempt: GateAttempt | null,
    fallbackReason: AuthGateReason = "generic",
): AuthEventContext & GateAttemptEventFields {
    const reason = attempt?.lastGateReason ?? fallbackReason;
    const continuity = gateAttemptEventFields(attempt);
    return {
        ...buildAuthOpenPayload(reason, {
            trigger_type: "user",
            ...continuity,
            ...(attempt?.jobId ? { job_id: attempt.jobId } : {}),
            ...(attempt?.returnTo ? { return_to: attempt.returnTo } : {}),
        }),
        ...continuity,
    };
}

import type { AuthGateReason } from "@/lib/auth/auth-gate-copy";
import type { OriginSurface } from "@/lib/auth/gate-attempt";

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

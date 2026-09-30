/**
 * Session-scoped auth gate continuity — survives WorkOS hard navigation and
 * attaches first/last gate reason to signup_completed / auth_method_selected.
 */

import type { AuthGateReason } from "@/lib/auth/auth-gate-copy";

export const GATE_ATTEMPT_STORAGE_KEY = "velai.auth.gateAttempt";

export type OriginSurface =
    | "jobs_banner"
    | "for_you"
    | "job_detail"
    | "resume_page"
    | "tracker"
    | "topbar"
    | "login";

export interface GateAttempt {
    pendingActionId: string;
    firstGateReason: AuthGateReason;
    lastGateReason: AuthGateReason;
    originSurface: OriginSurface;
    returnTo?: string;
    jobId?: string;
    createdAt: number;
}

export interface GateAttemptStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

export interface BeginGateAttemptInput {
    reason: AuthGateReason;
    originSurface: OriginSurface;
    pendingActionId?: string;
    returnTo?: string;
    jobId?: string;
    now?: number;
}

/** Stable anonymous attempt id — one per queued gate flow. */
export function generatePendingActionId(now = Date.now()): string {
    return `gate_${now}_${Math.random().toString(36).slice(2, 10)}`;
}

function isValidGateAttempt(value: unknown): value is GateAttempt {
    if (!value || typeof value !== "object") return false;
    const r = value as Record<string, unknown>;
    return (
        typeof r.pendingActionId === "string" &&
        typeof r.firstGateReason === "string" &&
        typeof r.lastGateReason === "string" &&
        typeof r.originSurface === "string" &&
        typeof r.createdAt === "number"
    );
}

export function readGateAttempt(storage: GateAttemptStorage): GateAttempt | null {
    let raw: string | null;
    try {
        raw = storage.getItem(GATE_ATTEMPT_STORAGE_KEY);
    } catch {
        return null;
    }
    if (!raw) return null;
    try {
        const parsed: unknown = JSON.parse(raw);
        return isValidGateAttempt(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

export function clearGateAttempt(storage: GateAttemptStorage): void {
    try {
        storage.removeItem(GATE_ATTEMPT_STORAGE_KEY);
    } catch {
        // Best-effort.
    }
}

/**
 * Open or update the in-flight gate attempt. `first_gate_reason` sticks;
 * `last_gate_reason` always updates. Reuses `pendingActionId` when one is
 * already open unless a new id is supplied explicitly.
 */
export function beginGateAttempt(
    storage: GateAttemptStorage,
    input: BeginGateAttemptInput,
): GateAttempt {
    const now = input.now ?? Date.now();
    const existing = readGateAttempt(storage);
    const pendingActionId = input.pendingActionId ?? existing?.pendingActionId ?? generatePendingActionId(now);
    const attempt: GateAttempt = {
        pendingActionId,
        firstGateReason: existing?.firstGateReason ?? input.reason,
        lastGateReason: input.reason,
        originSurface: input.originSurface,
        returnTo: input.returnTo ?? existing?.returnTo,
        jobId: input.jobId ?? existing?.jobId,
        createdAt: existing?.createdAt ?? now,
    };
    try {
        storage.setItem(GATE_ATTEMPT_STORAGE_KEY, JSON.stringify(attempt));
    } catch {
        // Best-effort — see pending-actions.ts.
    }
    return attempt;
}

/**
 * The conversion-gate id `signup_completed` carries as `gate` — which door the
 * visitor last walked through. One row per `AuthGateReason`, so adding a reason
 * without saying which gate it is fails to compile (no silent `undefined` gate).
 */
export type SignupGateId =
    | "resume_fit"
    | "save"
    | "follow"
    | "alert"
    | "depth"
    | "header"
    | "apply"
    | "tailor"
    | "packs"
    | "generic";

export const SIGNUP_GATE_ID_BY_REASON: Record<AuthGateReason, SignupGateId> = {
    fit: "resume_fit",
    resume: "resume_fit",
    save: "save",
    tracker: "save",
    follow: "follow",
    alert: "alert",
    depth: "depth",
    topbar: "header",
    apply: "apply",
    tailor: "tailor",
    packs: "packs",
    generic: "generic",
};

/** Shared payload fields for auth funnel events. */
export interface GateAttemptEventFields {
    /** Gate the visitor last engaged before converting (from `last_gate_reason`). */
    gate?: SignupGateId;
    first_gate_reason?: AuthGateReason;
    last_gate_reason?: AuthGateReason;
    pending_action_id?: string;
    origin_surface?: OriginSurface;
}

export function gateAttemptEventFields(attempt: GateAttempt | null): GateAttemptEventFields {
    if (!attempt) return {};
    return {
        gate: SIGNUP_GATE_ID_BY_REASON[attempt.lastGateReason],
        first_gate_reason: attempt.firstGateReason,
        last_gate_reason: attempt.lastGateReason,
        pending_action_id: attempt.pendingActionId,
        origin_surface: attempt.originSurface,
    };
}

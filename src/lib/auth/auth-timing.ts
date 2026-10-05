import { logServer } from "@/lib/observability/posthog-logs";

/**
 * How long the server spent on a sign-in or sign-out step, reported to
 * PostHog Logs only when it was slow enough to feel.
 *
 * Until 2026-10-05 nothing timed these steps, so "sign-in and sign-out take
 * forever" could only be read off page events: one recorded sign-out sat 5 s
 * between the click and the page leaving, and a Google sign-in's landing
 * paints 1.4 to 3.3 s after the redirects start. Only slow steps are logged
 * (warn), so a normal day costs nothing against the logs budget
 * (posthog-logs.ts) and a slow one shows which step it was.
 */
export const SLOW_AUTH_STEP_MS = 1_500;

export type AuthStep = "sign_in_callback" | "signup_claim" | "sign_out" | "sign_out_revoke" | "email_code";

/** Pure: is this duration worth a log line? */
export function isSlowAuthStep(durationMs: number): boolean {
    return Number.isFinite(durationMs) && durationMs >= SLOW_AUTH_STEP_MS;
}

/** Log `step` when it took `SLOW_AUTH_STEP_MS` or longer. Never PII: a status, an outcome, a count. */
export function reportAuthStep(
    step: AuthStep,
    durationMs: number,
    attrs: Record<string, string | number | boolean | undefined> = {},
): void {
    if (!isSlowAuthStep(durationMs)) return;
    logServer("warn", `slow auth step: ${step}`, { step, duration_ms: Math.round(durationMs), ...attrs });
}

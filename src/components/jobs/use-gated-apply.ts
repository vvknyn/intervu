"use client";

import { resolveApplyClickDecision } from "@/lib/jobs/pending-actions";
import type { AuthGateReason, AuthGateTrigger } from "@/lib/auth/auth-gate-copy";

/**
 * The one guest Apply-click gate (2026-09-18): every surface that can open
 * an employer's posting — the SERP, a job's own detail panel, and the
 * saved-job tracker — decides the same way whether a click may reach the
 * ATS, via the same `resolveApplyClickDecision` chokepoint. Signed in: run
 * `perform` immediately — today's unchanged behavior. Signed out: never
 * open the ATS from this click — persist it via `gate` and show the auth
 * popover instead. `perform` is never invoked automatically after auth
 * completes: `window.open` outside a user gesture is exactly what a popup
 * blocker exists to stop, so each consumer's own `apply` pending-action
 * handler must resurface a REAL click (a dialog/sheet button) rather than
 * calling `perform` itself from that callback.
 *
 * `Job` is whatever shape a consumer's `apply` pending-action already
 * carries as payload — a full `PublicJob` for jobs/page.tsx and
 * PublicJobDetail.tsx, or a bare apply URL for `/yours`, which can't always
 * resolve a full `PublicJob` at click time (see that page's own comment).
 */
/**
 * The one place a gated `perform` callback is allowed to actually leave for
 * an employer's apply_url — every consumer below calls this instead of
 * `window.open` directly, so tests/unit/apply-auth-first.test.ts's
 * call-site scan has exactly one sanctioned navigation site to name instead
 * of one raw `window.open` duplicated per caller.
 */
export function openApplyUrl(url: string): void {
    window.open(url, "_blank", "noopener,noreferrer");
}

export function useGatedApply<Job>({
    user,
    gate,
    setAuthGateReason,
    setAuthTrigger,
    perform,
}: {
    user: unknown;
    gate: (action: { kind: "apply"; payload: Job }) => void;
    setAuthGateReason: (reason: AuthGateReason) => void;
    /** Optional — only a surface with dynamic trigger-copy state needs this
     *  (jobs/page.tsx); a fixed `trigger="auto"` `<AuthPopover>` mount can
     *  omit it (PublicJobDetail.tsx, /yours). */
    setAuthTrigger?: (trigger: AuthGateTrigger) => void;
    perform: (job: Job) => void;
}): (job: Job) => void {
    return (job: Job) => {
        if (resolveApplyClickDecision(Boolean(user)) === "auth-first") {
            setAuthGateReason("apply");
            setAuthTrigger?.("auto");
            gate({ kind: "apply", payload: job });
            return;
        }
        perform(job);
    };
}

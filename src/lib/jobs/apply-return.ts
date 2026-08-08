/**
 * Apply-return capture (Zeigarnik Effect / "closing an open loop") — jobs/
 * page.tsx's `handleOpenPosting` sends a signed-in visitor to the employer's
 * site in a new tab; today "did you apply?" is 100% user-remembered (the
 * ledger only learns about it if they come back and press "Mark as applied"
 * themselves). This is the pure decision behind the tab-return prompt: given
 * how long the visitor was away and what's already known about this job/
 * session, should the app ask?
 *
 * Deliberately takes plain booleans/durations rather than a `PublicJob` or
 * `Date.now()` itself — the caller (page.tsx's `visibilitychange` handler)
 * owns the clock reads and the per-job "already prompted" bookkeeping (a
 * session-only `Set` — see its own comment), so this stays testable without
 * a DOM or a fake timer.
 */

/**
 * Below this, a tab switch reads as a glance (comparing tabs, a distraction),
 * not a genuine trip to the employer's application form.
 */
export const APPLY_RETURN_THRESHOLD_MS = 45_000;

export interface ShouldPromptApplyReturnInput {
    /** Milliseconds since `handleOpenPosting` sent this visitor away. */
    awayMs: number;
    /** This job is already marked applied (any source) — asking again would
     *  be noise, not a closed loop. */
    alreadyApplied: boolean;
    /** This exact job already triggered the prompt once this session — one
     *  prompt max per job per session (brief). */
    alreadyPrompted: boolean;
}

export function shouldPromptApplyReturn(input: ShouldPromptApplyReturnInput): boolean {
    if (input.alreadyApplied || input.alreadyPrompted) return false;
    return input.awayMs >= APPLY_RETURN_THRESHOLD_MS;
}

/**
 * Pure state machine deciding whether an auth popover is showing, evaluated
 * once per open TRANSITION rather than once per render.
 *
 * auth-popover.tsx used to call the (then side-effecting) auto-nudge check
 * directly in the render body. /jobs re-renders constantly; any re-render
 * while `trigger="auto"` and `open` re-ran the check, saw "already shown"
 * from the first render's own side effect, and flipped to suppressed — a
 * phantom close that fired `recordNudgeDismissed` for a close nobody made,
 * burning the 7-day suppression. Driving the decision off `open`/`close`
 * events instead of render count fixes that: once a reason has settled
 * into "shown" or "suppressed" for this popover instance, further `open`
 * events (i.e. re-renders while still open) are no-ops.
 */

import type { AuthGateReason } from "@/lib/auth/auth-gate-copy";

export type NudgeGateState = "idle" | "pending" | "shown" | "suppressed";

export type NudgeGateEvent = { type: "open"; trigger: "user" | "auto"; allowed: boolean } | { type: "close" };

/** The inputs the gate decided FOR — captured once so the consequence (marking
 * shown, recording a dismiss) reads what was decided, not whatever props say
 * at the time the consequence runs. */
export type NudgeDecision = { reason: AuthGateReason; trigger: "user" | "auto" };

/**
 * Decide once per open transition. `current` is the already-decided record
 * (or null before any decision); `decision` is what this call would decide
 * right now. A non-null `current` wins unchanged — this is what makes a
 * second "open" event during the same transition (React StrictMode's
 * synchronous double-invoke of an effect with no cleanup, or any other
 * re-render while still open) a no-op instead of a re-decide: StrictMode
 * runs the effect body twice against the same closed-over state before
 * either `setState` commits, so a check like `gate === "idle"` is true both
 * times and re-derives a fresh (possibly different) decision on run 2. A ref
 * holding the first call's record survives that double-invoke, so run 2
 * just returns it unchanged.
 */
export function decideNudgeOnce(current: NudgeDecision | null, decision: NudgeDecision): NudgeDecision {
    return current ?? decision;
}

export function nudgeGateNext(state: NudgeGateState, event: NudgeGateEvent): NudgeGateState {
    switch (event.type) {
        case "open":
            // Already decided for this open — a re-render must not re-decide.
            if (state === "shown" || state === "suppressed") return state;
            if (event.trigger === "user") return "shown";
            return event.allowed ? "shown" : "suppressed";
        case "close":
            return "idle";
    }
}

/** A dismiss is recordable only when the close leaves a nudge that was actually shown. */
export function shouldRecordDismiss(prev: NudgeGateState, next: NudgeGateState): boolean {
    return prev === "shown" && next === "idle";
}

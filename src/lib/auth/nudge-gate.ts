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

export type NudgeGateState = "idle" | "pending" | "shown" | "suppressed";

export type NudgeGateEvent = { type: "open"; trigger: "user" | "auto"; allowed: boolean } | { type: "close" };

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

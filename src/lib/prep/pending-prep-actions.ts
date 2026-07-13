/**
 * Pending post-auth action state for prep mode start (pure reducer).
 *
 * A logged-out user can click Start Learn / Start Practice on the mode screen.
 * That queues a start payload and opens the auth popover; after sign-in the
 * queued action replays exactly once. Dismissing the popover clears the queue
 * so an unrelated later sign-in (e.g. sidebar "Log in") never fires a phantom
 * session start.
 */

import type { PrepJobContext } from "@/lib/prep/job-context";
import type { PrepSessionMode } from "@/lib/prep/session-progress";
import type { QuestionSettings } from "@/components/dashboard/PrepSettings";

export interface PendingPrepStartPayload {
    jobContext: PrepJobContext;
    mode: PrepSessionMode;
    prepSettings: QuestionSettings;
    planCacheKey: string;
}

export interface PendingPrepState {
    start: PendingPrepStartPayload | null;
}

export type PendingPrepAction =
    | { kind: "start"; payload: PendingPrepStartPayload };

export function emptyPendingPrep(): PendingPrepState {
    return { start: null };
}

export function hasPendingPrep(s: PendingPrepState): boolean {
    return s.start !== null;
}

/** Queue one start action. Always replaces any previously queued start. */
export function queuePendingPrep(
    _prev: PendingPrepState,
    action: PendingPrepAction,
): PendingPrepState {
    if (action.kind === "start") {
        return { start: action.payload };
    }
    return emptyPendingPrep();
}

/** Clear everything pending — dismiss / alternate path. */
export function clearPendingPrep(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _prev: PendingPrepState,
): PendingPrepState {
    return emptyPendingPrep();
}

/** Consume the queued start on sign-in. `next` is always empty. */
export function takePrepReplay(s: PendingPrepState): {
    next: PendingPrepState;
    action: PendingPrepAction | null;
} {
    const next = emptyPendingPrep();
    if (s.start !== null) {
        return { next, action: { kind: "start", payload: s.start } };
    }
    return { next, action: null };
}

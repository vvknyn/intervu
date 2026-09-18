/**
 * Pure elapsed-time → copy ladder for ForYouPack's "loading" description
 * pane (`descriptionPaneState` === "loading", lib/jobs/for-you/
 * description-pane-state.ts). No new pane state: this only decides what to
 * SAY while that existing state holds, driven by how long it's held for —
 * a bare spinner past a few seconds reads as broken (see "a transient lie
 * is still a lie" — a stuck spinner with no honest copy is the same class
 * of defect as a wrong-but-confident label).
 *
 * `failureAfterMs` is expected to be the caller's fetch deadline
 * (`DETAIL_FETCH_TIMEOUT_MS`, lib/jobs/detail-fetch.ts) — the real ceiling
 * by which the underlying fetch is GUARANTEED to have settled one way or
 * another (its own `AbortSignal` fires at that deadline). `descriptionPending`
 * still being true past that point can only mean the fetch settled to
 * "unknown" (network failure or its own timeout) and page.tsx's
 * `handleForYouActivePackChange` mapped that back to `descriptionPending:
 * true` (never lie "empty" from an inconclusive check) — never that the
 * fetch is still genuinely in flight. That's the only signal available at
 * this layer to distinguish "still working" from "failed" without
 * threading a new prop through ForYouDeck/ForYouPack for a distinction the
 * fetch layer already makes.
 */
export const DESCRIPTION_WAIT_COPY_MS = 1500;
export const DESCRIPTION_STALL_COPY_MS = 6000;

export type DescriptionWaitPhase = "start" | "wait" | "stall" | "failed";

export const DESCRIPTION_START_COPY = "Loading description…";
export const DESCRIPTION_WAIT_COPY = "Fetching the full posting from the employer…";
export const DESCRIPTION_STALL_COPY = "Still working. The employer's site is slow — you can skip and come back.";
export const DESCRIPTION_FAILURE_COPY = "Couldn't load the full posting right now.";

/** Pure: which phase of the copy ladder above applies at `elapsedMs`. */
export function descriptionWaitPhase(elapsedMs: number, failureAfterMs: number): DescriptionWaitPhase {
    if (elapsedMs >= failureAfterMs) return "failed";
    if (elapsedMs >= DESCRIPTION_STALL_COPY_MS) return "stall";
    if (elapsedMs >= DESCRIPTION_WAIT_COPY_MS) return "wait";
    return "start";
}

/** Pure: the exact copy for a given phase — one source of truth so the
 *  component below never inlines these strings a second time. */
export function descriptionWaitCopy(phase: DescriptionWaitPhase): string {
    switch (phase) {
        case "start":
            return DESCRIPTION_START_COPY;
        case "wait":
            return DESCRIPTION_WAIT_COPY;
        case "stall":
            return DESCRIPTION_STALL_COPY;
        case "failed":
            return DESCRIPTION_FAILURE_COPY;
    }
}

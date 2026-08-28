/**
 * Pure decision half of the SERP impression tracker
 * (`useResultImpressions.ts`, same directory) — no DOM, no timers, so it's
 * unit-testable without an IntersectionObserver mock.
 *
 * Two operations, mirroring the observer/debounce split the hook drives:
 *   - `recordImpression` — a row crossed the ≥50%-visible threshold. Adds it
 *     to the pending batch UNLESS it's already been reported this mount
 *     (dedupe) or is already pending (idempotent re-entry).
 *   - `flushImpressions` — the 1s debounce fired. Drains the whole pending
 *     batch into one `job_ids` list for a single `results_impressed` call,
 *     and folds it into `reported` so none of those ids can re-enter
 *     `pending` later in the same mount (e.g. scrolled away and back).
 */

export interface ImpressionBatchState {
  /** job_ids already flushed (reported) this mount — permanent, never re-added. */
  reported: ReadonlySet<string>;
  /** job_ids seen since the last flush, waiting to be reported. */
  pending: ReadonlySet<string>;
}

export const EMPTY_IMPRESSION_BATCH: ImpressionBatchState = {
  reported: new Set(),
  pending: new Set(),
};

/** A row became ≥50% visible. No-op if already reported or already pending. */
export function recordImpression(state: ImpressionBatchState, jobId: string): ImpressionBatchState {
  if (state.reported.has(jobId) || state.pending.has(jobId)) return state;
  return { reported: state.reported, pending: new Set(state.pending).add(jobId) };
}

/**
 * The debounce timer fired. Returns the job_ids to report (empty if nothing
 * was pending — callers should skip capturing in that case) and the next
 * state with those ids moved from `pending` into `reported`.
 */
export function flushImpressions(state: ImpressionBatchState): {
  jobIds: string[];
  next: ImpressionBatchState;
} {
  if (state.pending.size === 0) return { jobIds: [], next: state };
  const jobIds = Array.from(state.pending);
  return {
    jobIds,
    next: {
      reported: new Set([...state.reported, ...jobIds]),
      pending: new Set(),
    },
  };
}

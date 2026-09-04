/**
 * Pure decision half of the SERP impression tracker
 * (`useResultImpressions.ts`, same directory) — no DOM, no timers, so it's
 * unit-testable without an IntersectionObserver mock.
 *
 * Two operations, mirroring the observer/debounce split the hook drives:
 *   - `recordImpression` — a row crossed the ≥50%-visible threshold. Adds it
 *     to the pending batch UNLESS it's already been reported for this
 *     `queryId` (dedupe) or is already pending (idempotent re-entry).
 *   - `flushImpressions` — the 1s debounce fired. Drains the whole pending
 *     batch into one `{jobId, position}[]` list for a single
 *     `results_impressed` call, and folds it into `reported` so none of
 *     those (queryId, jobId) pairs can re-enter `pending` later for the
 *     SAME query (e.g. scrolled away and back).
 *
 * Dedupe is keyed on `${queryId}:${jobId}`, not `jobId` alone — a job
 * re-shown for a REFINED query (a new `queryId`, same result or not) is a
 * different key and IS eligible for a fresh impression. Without `queryId` in
 * the key, a job that appears in every refinement of a search would only
 * ever be impressed once per page mount, permanently undercounting its
 * denominator (SPEC §1: a click log needs a true impression denominator to
 * be interpretable at all).
 */

export interface PendingImpression {
  jobId: string;
  /** 1-based index of this row in the rendered result list at the moment it
   *  became visible. */
  position: number;
}

export interface ImpressionBatchState {
  /** `${queryId}:${jobId}` keys already flushed — permanent for that query,
   *  never re-added while the same `queryId` is active. */
  reported: ReadonlySet<string>;
  /** `${queryId}:${jobId}` -> pending impression, seen since the last flush,
   *  waiting to be reported. */
  pending: ReadonlyMap<string, PendingImpression>;
}

export const EMPTY_IMPRESSION_BATCH: ImpressionBatchState = {
  reported: new Set(),
  pending: new Map(),
};

function dedupeKey(queryId: string, jobId: string): string {
  return `${queryId}:${jobId}`;
}

/** A row became ≥50% visible. No-op if already reported for this `queryId`
 *  or already pending. */
export function recordImpression(
  state: ImpressionBatchState,
  queryId: string,
  jobId: string,
  position: number,
): ImpressionBatchState {
  const key = dedupeKey(queryId, jobId);
  if (state.reported.has(key) || state.pending.has(key)) return state;
  const pending = new Map(state.pending);
  pending.set(key, { jobId, position });
  return { reported: state.reported, pending };
}

/**
 * The debounce timer fired. Returns the impressions to report (empty if
 * nothing was pending — callers should skip capturing in that case) and the
 * next state with those keys moved from `pending` into `reported`.
 */
export function flushImpressions(state: ImpressionBatchState): {
  impressions: PendingImpression[];
  next: ImpressionBatchState;
} {
  if (state.pending.size === 0) return { impressions: [], next: state };
  const impressions = Array.from(state.pending.values());
  const reported = new Set(state.reported);
  for (const key of state.pending.keys()) reported.add(key);
  return { impressions, next: { reported, pending: new Map() } };
}

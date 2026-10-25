/**
 * Reading the per-employer `company_*` aggregates off a company's hit list.
 *
 * These fields are stamped onto job DOCUMENTS at sync time, and the sync fills
 * the index progressively (the 5-minute "changed" lane moves a few thousand of
 * ~2.1M docs per run). So at any moment a company's hits are a mix: some
 * documents carry the aggregates, some were last synced before the aggregates
 * existed and carry nothing. Reading them off `jobs[0]` therefore made the
 * employer's track record appear or vanish depending on where the sorted hit
 * window happened to land — the same company page showing history on one query
 * and none on the next. Read from the first hit that actually HAS the value
 * instead, and the page shows what the corpus knows as soon as ANY of the
 * company's documents knows it.
 *
 * WHEN TWO HITS DISAGREE (both non-null, different numbers — one document
 * synced before tonight's recompute, one after):
 *
 *   - Values are NOT mixed across documents. A set read field-by-field could
 *     pair Monday's `opened` with Wednesday's `closed` and render them as one
 *     90-day window — a ratio that was never simultaneously true. Whatever the
 *     page shows is one document's snapshot, internally consistent, every
 *     number in it true at the same moment. That is the shape that cannot
 *     present a stale number as a current one; a coherent-but-slightly-old
 *     snapshot can only be old, it cannot be self-contradictory.
 *
 *   - Disagreement does NOT suppress the value. Each document carries the
 *     vintage of its own last sync, so a spread of vintages across a company's
 *     documents is the steady state of this pipeline, not a transient — hiding
 *     on disagreement would permanently blank the track record for exactly the
 *     employers with the most documents.
 *
 *   - Ties are NOT broken on the values themselves. Preferring the larger
 *     `opened_90d` would flatter every employer, the smaller would slander
 *     them; both invent a preference the data does not carry. Nor is there a
 *     per-document sync timestamp to prefer the freshest by: `PublicJob`
 *     carries only the JOB's `updated_at`, which is the listing's own change
 *     time and not a record of when the document was re-synced. So the pick is
 *     hit order — deterministic for a given query, which is what stops the
 *     flicker, and honest about being an arbitrary choice among equals.
 */
import type { PublicJob } from "@/lib/jobs/types";

/**
 * The first value any hit actually carries, or null when none does.
 *
 * `read` returning null/undefined means "this hit does not carry it", so a
 * reader can also express a composite that is only meaningful whole and get
 * single-document sourcing for free. Absence stays null — it never becomes 0.
 */
export function firstNonNull<T>(
  jobs: readonly PublicJob[],
  read: (job: PublicJob) => T | null | undefined,
): T | null {
  for (const job of jobs) {
    const value = read(job);
    if (value != null) return value;
  }
  return null;
}

/** An employer's open/close history for the trailing 90 days, as one job document carries it (job pages only; company pages read `IntegrityFacts`). */
export type TrackRecord = { opened90d: number; closed90d: number };

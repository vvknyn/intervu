/**
 * Distinguishes "this job ran and correctly had nothing to do" from "this
 * job ran and COULD NOT have done anything" — today those two are
 * indistinguishable from a heartbeat row alone. Measured on prod
 * 2026-09-04:
 *
 *   roll-up-telemetry: window=2d feature_window=90d job_daily=0
 *   company_daily=0 feature_outcomes=0
 *
 * exit=0, ok=true, rows_affected=0 (roll-up-telemetry.ts sums the three
 * table row counts into one number). That shape is written on EVERY
 * zero-output run regardless of cause: a genuinely quiet window looks
 * identical to a completely dead ingest path. Same class of bug as the
 * subspace `reap_telemetry` heartbeat that ran ok=true daily while its
 * DELETE matched zero rows for 90 days — liveness came from the wrapper
 * reaching its own write call, not from the work actually having input.
 *
 * THE PREDICATE, and why it never names a job: a job's own output count
 * cannot tell the two states apart — it is exactly the number that reads
 * the same (0) either way. The one fact no per-job output can fake is
 * whether the SHARED ingest ledger (`intervu.telemetry_events`, the single
 * table every one of these jobs ultimately reads from) received anything
 * recently. So this checks, for any heartbeat row that claims "ran
 * successfully, wrote nothing" (ok=true, rows_affected=0), whether that
 * claim is business-plausible: plausible if the ledger itself was alive
 * within the same recency window (idle-but-healthy — this job's own
 * narrower slice of real traffic came up empty), not plausible if the
 * ledger has been silent for longer than that window (starved — there was
 * nothing in the ledger for ANY job to read, so the zero proves nothing
 * about business activity).
 *
 * This is deliberately keyed on the SHAPE of a heartbeat row (ok,
 * rows_affected), never on job_name — see deploy/run-telemetry-job.sh's own
 * comment on its job-name gate: "a gate that enumerates the jobs someone
 * thought of stops being a gate the day someone adds one." Any job that
 * upserts through `writeHeartbeat` (heartbeat.ts) and ultimately depends on
 * `telemetry_events` is covered by construction, including ones added
 * after this file is written.
 *
 * Kept pure and DB-free on purpose: the caller (scripts/check-telemetry-liveness.ts)
 * does the two reads and passes in plain rows plus `now`, so this is
 * unit-testable over fixtures without a live database — see
 * tests/unit/telemetry-liveness.test.ts.
 *
 * TOTALITY, measured on this file itself 2026-09-04: the first version only
 * returned starvedJobs and idleHealthyJobs, so a row matching neither — a
 * stale lastRunAt outside the window, an ok=false failure, or an ok=true run
 * that actually did work — vanished with no trace. A checker that goes quiet
 * on the inputs it doesn't recognize is exactly the failure class this file
 * exists to catch, so every heartbeat row now lands in exactly one of five
 * buckets and the function throws if any row lands in none of them.
 */

export interface JobHeartbeatRow {
  jobName: string;
  lastRunAt: Date;
  rowsAffected: number | null;
  ok: boolean;
}

export interface TelemetryLivenessResult {
  /** True when at least one zero-output run cannot be explained by real idleness. */
  starved: boolean;
  /** Job names whose ok=true/rows_affected=0 run is starvation, not idleness. */
  starvedJobs: string[];
  /** Job names with the same zero-output shape, cleared because the ledger itself was fresh. */
  idleHealthyJobs: string[];
  /** Job names whose lastRunAt is older than staleAfterMs — did not report in the window at all. */
  silentJobs: string[];
  /** Job names that ran within the window and reported ok=false — a job failure, not this predicate's starvation concern. */
  failedJobs: string[];
  /** Job names that ran within the window with ok=true and non-zero (or null) rows_affected — did real work. */
  productiveJobs: string[];
}

/**
 * Default recency window: a job's zero-output run is only evaluated against
 * ledger freshness if the run itself happened within this window, and the
 * ledger is considered "alive" if its newest event falls within the same
 * window. 24h is generous enough that one quiet night does not misfire, and
 * tight enough to catch a dead ingest path the same day it starts (the
 * 2026-09-04 incident had been silent far longer than this).
 */
export const DEFAULT_STARVED_AFTER_HOURS = 24;

export function classifyTelemetryLiveness(
  heartbeats: readonly JobHeartbeatRow[],
  lastEventAt: Date | null,
  now: Date,
  staleAfterMs: number,
): TelemetryLivenessResult {
  const silentJobs = heartbeats.filter((h) => now.getTime() - h.lastRunAt.getTime() > staleAfterMs);
  const inWindow = heartbeats.filter((h) => now.getTime() - h.lastRunAt.getTime() <= staleAfterMs);

  const failedJobs = inWindow.filter((h) => !h.ok);
  const okInWindow = inWindow.filter((h) => h.ok);
  const productiveJobs = okInWindow.filter((h) => h.rowsAffected !== 0);
  const zeroOutputRuns = okInWindow.filter((h) => h.rowsAffected === 0);

  const ingestFresh = lastEventAt !== null && now.getTime() - lastEventAt.getTime() <= staleAfterMs;
  const starved = !ingestFresh && zeroOutputRuns.length > 0;

  const result: TelemetryLivenessResult = {
    starved,
    starvedJobs: starved ? zeroOutputRuns.map((h) => h.jobName) : [],
    idleHealthyJobs: starved ? [] : zeroOutputRuns.map((h) => h.jobName),
    silentJobs: silentJobs.map((h) => h.jobName),
    failedJobs: failedJobs.map((h) => h.jobName),
    productiveJobs: productiveJobs.map((h) => h.jobName),
  };

  const bucketed =
    result.starvedJobs.length +
    result.idleHealthyJobs.length +
    result.silentJobs.length +
    result.failedJobs.length +
    result.productiveJobs.length;
  if (bucketed !== heartbeats.length) {
    throw new Error(
      `classifyTelemetryLiveness: totality invariant violated — ${heartbeats.length} heartbeat(s) in, ` +
        `${bucketed} landed in a bucket (shortfall ${heartbeats.length - bucketed}). A row matched none of ` +
        `silentJobs/failedJobs/productiveJobs/starvedJobs/idleHealthyJobs — check for an unparseable lastRunAt.`,
    );
  }

  return result;
}

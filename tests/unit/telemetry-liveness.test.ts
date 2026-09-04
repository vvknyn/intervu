import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyTelemetryLiveness, type JobHeartbeatRow } from "@/lib/telemetry/liveness";

const HOUR = 3_600_000;
const STALE_AFTER_MS = 24 * HOUR;
const NOW = new Date("2026-09-04T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

function heartbeat(overrides: Partial<JobHeartbeatRow> & { jobName: string }): JobHeartbeatRow {
  return {
    lastRunAt: NOW,
    rowsAffected: 0,
    ok: true,
    ...overrides,
  };
}

describe("classifyTelemetryLiveness", () => {
  it("STARVED — a zero-output run with a dead ledger (the measured 2026-09-04 defect: roll-up-telemetry ok=true rows_affected=0, no events ever)", () => {
    const result = classifyTelemetryLiveness(
      [heartbeat({ jobName: "roll-up-telemetry" })],
      null, // telemetry_events has never received a row
      NOW,
      STALE_AFTER_MS,
    );
    assert.equal(result.starved, true);
    assert.deepEqual(result.starvedJobs, ["roll-up-telemetry"]);
    assert.deepEqual(result.idleHealthyJobs, []);
  });

  it("STARVED — ledger has old rows, but nothing recent enough to explain the zero (a class-wide instance, not the same job)", () => {
    const result = classifyTelemetryLiveness(
      [heartbeat({ jobName: "build-job-features" })],
      new Date(NOW.getTime() - 30 * HOUR), // last event 30h ago, outside the 24h window
      NOW,
      STALE_AFTER_MS,
    );
    assert.equal(result.starved, true);
    assert.deepEqual(result.starvedJobs, ["build-job-features"]);
  });

  it("IDLE-BUT-HEALTHY — zero output, but the ledger received an event within the window (real traffic exists, this job's own slice was genuinely empty)", () => {
    const result = classifyTelemetryLiveness(
      [heartbeat({ jobName: "roll-up-telemetry" })],
      new Date(NOW.getTime() - 2 * HOUR), // an event landed 2h ago
      NOW,
      STALE_AFTER_MS,
    );
    assert.equal(result.starved, false);
    assert.deepEqual(result.starvedJobs, []);
    assert.deepEqual(result.idleHealthyJobs, ["roll-up-telemetry"]);
  });

  it("HEALTHY — no zero-output run to evaluate at all (job actually processed rows)", () => {
    const result = classifyTelemetryLiveness(
      [heartbeat({ jobName: "roll-up-telemetry", rowsAffected: 42 })],
      null,
      NOW,
      STALE_AFTER_MS,
    );
    assert.equal(result.starved, false);
    assert.deepEqual(result.starvedJobs, []);
    assert.deepEqual(result.idleHealthyJobs, []);
  });

  it("never flags a job by name — a DIFFERENT, previously-unseen job name with the identical zero-output+dead-ledger shape is still caught (class-wide, not instance-specific)", () => {
    const result = classifyTelemetryLiveness(
      [heartbeat({ jobName: "some-future-job-nobody-has-written-yet" })],
      null,
      NOW,
      STALE_AFTER_MS,
    );
    assert.equal(result.starved, true);
    assert.deepEqual(result.starvedJobs, ["some-future-job-nobody-has-written-yet"]);
  });

  it("ignores a failed run (ok=false) — that is a job-failure signal, not this predicate's concern", () => {
    const result = classifyTelemetryLiveness(
      [heartbeat({ jobName: "roll-up-telemetry", ok: false, rowsAffected: null })],
      null,
      NOW,
      STALE_AFTER_MS,
    );
    assert.equal(result.starved, false);
    assert.deepEqual(result.starvedJobs, []);
    assert.deepEqual(result.idleHealthyJobs, []);
  });

  it("ignores a stale zero-output heartbeat outside the recency window — it is not evidence about the pipeline's CURRENT state", () => {
    const result = classifyTelemetryLiveness(
      [heartbeat({ jobName: "reap-telemetry", lastRunAt: new Date(NOW.getTime() - 48 * HOUR) })],
      null,
      NOW,
      STALE_AFTER_MS,
    );
    assert.equal(result.starved, false);
    assert.deepEqual(result.starvedJobs, []);
    assert.deepEqual(result.idleHealthyJobs, []);
  });

  it("mixed fleet — one job genuinely idle, ledger fresh, both classified against the SAME shared ledger fact (no per-job ledger check)", () => {
    const result = classifyTelemetryLiveness(
      [
        heartbeat({ jobName: "roll-up-telemetry", rowsAffected: 0 }),
        heartbeat({ jobName: "reap-telemetry", rowsAffected: 0 }),
      ],
      new Date(NOW.getTime() - 1 * HOUR),
      NOW,
      STALE_AFTER_MS,
    );
    assert.equal(result.starved, false);
    assert.deepEqual(result.idleHealthyJobs.sort(), ["reap-telemetry", "roll-up-telemetry"]);
  });

  // Boundary probes below (B1-B9) folded in from a temporary spot-check —
  // inputs this file's author did not choose. B2 and B7 originally
  // documented the totality defect this file now fixes; both are updated
  // here to assert the corrected behaviour instead of the drop.

  it("B1 heartbeat EXACTLY at the window edge is still evaluated", () => {
    const r = classifyTelemetryLiveness([heartbeat({ jobName: "j", lastRunAt: ago(STALE_AFTER_MS) })], null, NOW, STALE_AFTER_MS);
    assert.equal(r.starved, true);
    assert.deepEqual(r.starvedJobs, ["j"]);
  });

  it("B2 heartbeat 1ms OUTSIDE the window now lands in silentJobs instead of vanishing (the totality fix)", () => {
    const r = classifyTelemetryLiveness(
      [heartbeat({ jobName: "j", lastRunAt: ago(STALE_AFTER_MS + 1) })],
      null,
      NOW,
      STALE_AFTER_MS,
    );
    assert.deepEqual(r, {
      starved: false,
      starvedJobs: [],
      idleHealthyJobs: [],
      silentJobs: ["j"],
      failedJobs: [],
      productiveJobs: [],
    });
  });

  it("B3 ledger event EXACTLY at the edge counts as fresh", () => {
    const r = classifyTelemetryLiveness([heartbeat({ jobName: "j", lastRunAt: ago(HOUR) })], ago(STALE_AFTER_MS), NOW, STALE_AFTER_MS);
    assert.equal(r.starved, false);
    assert.deepEqual(r.idleHealthyJobs, ["j"]);
  });

  it("B4 ledger event 1ms past the edge flips to starved", () => {
    const r = classifyTelemetryLiveness(
      [heartbeat({ jobName: "j", lastRunAt: ago(HOUR) })],
      ago(STALE_AFTER_MS + 1),
      NOW,
      STALE_AFTER_MS,
    );
    assert.equal(r.starved, true);
  });

  it("B5 rows_affected NULL with ok=true is now classified as productive, not dropped", () => {
    const r = classifyTelemetryLiveness(
      [heartbeat({ jobName: "j", lastRunAt: ago(HOUR), rowsAffected: null })],
      null,
      NOW,
      STALE_AFTER_MS,
    );
    assert.deepEqual(r, {
      starved: false,
      starvedJobs: [],
      idleHealthyJobs: [],
      silentJobs: [],
      failedJobs: [],
      productiveJobs: ["j"],
    });
  });

  it("B6 an event NEWER than the heartbeat clears a run it could not have fed", () => {
    // job ran 23h ago into a dead ledger; ingest resumed 1 min ago.
    const r = classifyTelemetryLiveness(
      [heartbeat({ jobName: "j", lastRunAt: ago(23 * HOUR) })],
      ago(60_000),
      NOW,
      STALE_AFTER_MS,
    );
    assert.equal(r.starved, false);
    assert.deepEqual(r.idleHealthyJobs, ["j"]);
  });

  it("B7 EMPTY fleet reports healthy at the pure-function level — this is expected (nothing to bucket, invariant holds trivially); the real alarm for cron dying entirely is the script's NO HEARTBEATS check, not this predicate", () => {
    const r = classifyTelemetryLiveness([], null, NOW, STALE_AFTER_MS);
    assert.equal(r.starved, false);
    assert.deepEqual(r.silentJobs, []);
    assert.deepEqual(r.failedJobs, []);
    assert.deepEqual(r.productiveJobs, []);
  });

  it("B8 mixed fleet: dead ledger names every in-window zero run, and the stale one now lands in silentJobs instead of dropping", () => {
    const r = classifyTelemetryLiveness(
      [
        heartbeat({ jobName: "fresh-zero", lastRunAt: ago(HOUR) }),
        heartbeat({ jobName: "stale-zero", lastRunAt: ago(STALE_AFTER_MS + 1) }),
        heartbeat({ jobName: "productive", lastRunAt: ago(HOUR), rowsAffected: 4210 }),
        heartbeat({ jobName: "failed", lastRunAt: ago(HOUR), ok: false, rowsAffected: null }),
      ],
      null,
      NOW,
      STALE_AFTER_MS,
    );
    assert.equal(r.starved, true);
    assert.deepEqual(r.starvedJobs, ["fresh-zero"]);
    assert.deepEqual(r.silentJobs, ["stale-zero"]);
    assert.deepEqual(r.productiveJobs, ["productive"]);
    assert.deepEqual(r.failedJobs, ["failed"]);
  });

  it("B9 fresh ledger cannot produce a split verdict — all zero runs clear together", () => {
    const r = classifyTelemetryLiveness(
      [heartbeat({ jobName: "a", lastRunAt: ago(HOUR) }), heartbeat({ jobName: "b", lastRunAt: ago(2 * HOUR) })],
      ago(60_000),
      NOW,
      STALE_AFTER_MS,
    );
    assert.deepEqual(r.starvedJobs, []);
    assert.deepEqual(r.idleHealthyJobs, ["a", "b"]);
  });

  it("totality invariant THROWS when a row's lastRunAt is unparseable (NaN) — no predicate's comparison matches, so no bucket claims it, and that must crash rather than silently disappear", () => {
    const corrupt: JobHeartbeatRow = {
      jobName: "corrupt-timestamp",
      lastRunAt: new Date(NaN),
      rowsAffected: 0,
      ok: true,
    };
    assert.throws(
      () => classifyTelemetryLiveness([corrupt], null, NOW, STALE_AFTER_MS),
      /totality invariant violated/,
    );
  });
});

/**
 * Exhaustive partition guard. The B-tests above are exemplars — each one is a
 * shape someone thought of. This block is the method the exemplars cannot be:
 * it enumerates the full cartesian product of row shapes and asserts every row
 * lands in exactly one bucket, so a future branch added without a matching
 * bucket fails here rather than silently dropping rows. That silent drop is
 * the defect this whole file exists to prevent — B2 and B7 were GREEN while it
 * was live, because a dropped row asserts nothing.
 */
describe("exhaustive partition", () => {
  const OKS = [true, false];
  const ROWS: (number | null)[] = [0, 5, -1, null];
  const AGES = [0, HOUR, STALE_AFTER_MS, STALE_AFTER_MS + 1, 10 * 24 * HOUR];
  const LEDGERS: (Date | null)[] = [null, ago(60_000), ago(STALE_AFTER_MS + 1)];

  const bucketsOf = (r: ReturnType<typeof classifyTelemetryLiveness>): string[][] => [
    r.starvedJobs,
    r.idleHealthyJobs,
    r.silentJobs,
    r.failedJobs,
    r.productiveJobs,
  ];

  it("places every (ok x rowsAffected x age x ledger) shape in exactly one bucket", () => {
    let shapes = 0;
    for (const ok of OKS) {
      for (const rowsAffected of ROWS) {
        for (const age of AGES) {
          for (const lastEventAt of LEDGERS) {
            shapes += 1;
            const row = heartbeat({ jobName: `j-${shapes}`, lastRunAt: ago(age), rowsAffected, ok });
            const result = classifyTelemetryLiveness([row], lastEventAt, NOW, STALE_AFTER_MS);
            const appearances = bucketsOf(result).filter((b) => b.includes(row.jobName)).length;
            assert.equal(
              appearances,
              1,
              `ok=${ok} rows=${rowsAffected} age=${age} ledger=${lastEventAt?.toISOString() ?? "null"} appeared in ${appearances} buckets`,
            );
          }
        }
      }
    }
    assert.equal(shapes, 120);
  });

  it("stays total when all 120 shapes arrive in ONE fleet", () => {
    const fleet: JobHeartbeatRow[] = [];
    for (const ok of OKS) {
      for (const rowsAffected of ROWS) {
        for (const age of AGES) {
          for (const dup of [1, 2, 3]) {
            fleet.push({ jobName: `j-${fleet.length}-${dup}`, lastRunAt: ago(age), rowsAffected, ok });
          }
        }
      }
    }
    const result = classifyTelemetryLiveness(fleet, null, NOW, STALE_AFTER_MS);
    const total = bucketsOf(result).reduce((n, b) => n + b.length, 0);
    assert.equal(total, fleet.length);
  });
});

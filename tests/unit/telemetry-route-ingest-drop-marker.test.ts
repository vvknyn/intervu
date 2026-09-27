import { test, beforeEach, type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  writeAdmittedRows,
  GET,
  TELEMETRY_INGEST_DROPPED_MARKER,
  getTelemetryIngestDropStats,
  resetDroppedIngestLogForTests,
} from "../../src/app/api/telemetry/route";
import type { Queryable } from "../../src/lib/pg/pool";
import { ANALYTICS_EVENTS } from "../../src/lib/analytics/event-names";
import type { TelemetryRow } from "../../src/lib/telemetry/types";

const FIXTURE_EVENT_NAME = Object.values(ANALYTICS_EVENTS)[0];

/**
 * THE MEASURED DEFECT (deploy/db-box/preflight-telemetry-connectivity.sh:11-13):
 * guard 8's try/catch swallows a Postgres connection FATAL and still
 * returns 204 — the client contract is correct (telemetry must never break
 * a page), but before this fix the ONLY server-side trace was a single
 * unstructured, un-throttled `console.error` line with no distinctive
 * marker and no way for an automated check to tell "one drop" from "still
 * dropping right now."
 *
 * Retargeted (2026-09-04, after prod measurement showed the log already
 * exists but is neither structured nor countable): this file asserts the
 * marker AND the live, countable signal — `getTelemetryIngestDropStats()` /
 * `GET /api/telemetry` — keep moving on every drop even after the
 * once-per-process stdout line has already fired and gone silent.
 *
 * `writeAdmittedRows` takes a plain `Queryable`, so this drives the real
 * production code path with a fake connection instead of mocking
 * `getTelemetryPg`/`getServerUser`/a Next `Request`.
 */

function makeRow(id: string): TelemetryRow {
  return {
    event_id: id,
    occurred_at: new Date().toISOString(),
    session_id: "s1",
    visitor_id: null,
    user_id: null,
    event_name: FIXTURE_EVENT_NAME,
    source: null,
    query_id: null,
    job_id: null,
    company_domain: null,
    position: null,
    props: {},
  };
}

function mockConsoleError(t: TestContext) {
  return t.mock.method(console, "error", () => {});
}

beforeEach(() => {
  resetDroppedIngestLogForTests();
});

test("writeAdmittedRows: a query that throws AFTER a successful connect logs the marker and counts the drop", async (t) => {
  const err = mockConsoleError(t);
  // `pg` is non-null (a "connection" exists) — the failure surfaces only
  // when `.query()` runs, exactly like a Postgres connection FATAL that
  // rejects mid-authentication rather than at TCP connect time.
  const throwingPg: Queryable = {
    query: async () => {
      throw new Error("FATAL: no pg_hba.conf entry for host");
    },
  };

  await writeAdmittedRows(throwingPg, [makeRow("a")]);

  assert.equal(err.mock.calls.length, 1, "the drop must be logged");
  const loggedArgs = err.mock.calls[0].arguments.map(String).join(" ");
  assert.match(loggedArgs, new RegExp(TELEMETRY_INGEST_DROPPED_MARKER), "log must carry the distinctive marker");

  const stats = getTelemetryIngestDropStats();
  assert.equal(stats.droppedCount, 1, "the dropped row must be counted");
  assert.notEqual(stats.lastDroppedAt, null, "a drop must stamp a live timestamp");
});

test("CONTROL: a successful write never logs the marker and never moves the drop stats", async (t) => {
  const err = mockConsoleError(t);
  const healthyPg: Queryable = {
    query: async () => ({ rows: [] }),
  };

  await writeAdmittedRows(healthyPg, [makeRow("b")]);

  assert.equal(err.mock.calls.length, 0, "a successful write must not log anything");
  assert.deepEqual(
    getTelemetryIngestDropStats(),
    { droppedCount: 0, lastDroppedAt: null },
    "the marker/stats must stay absent on the healthy path",
  );
});

test("a sustained failure keeps counting after the once-per-process log line has already fired", async (t) => {
  const err = mockConsoleError(t);
  const throwingPg: Queryable = {
    query: async () => {
      throw new Error("connection terminated unexpectedly");
    },
  };

  await writeAdmittedRows(throwingPg, [makeRow("c"), makeRow("d")]); // logs once, count=2
  await writeAdmittedRows(throwingPg, [makeRow("e")]); // silent on stdout, count must still move

  assert.equal(err.mock.calls.length, 1, "stdout stays throttled to once per process");
  assert.equal(
    getTelemetryIngestDropStats().droppedCount,
    3,
    "the live counter must keep advancing after the stdout line has gone silent — this is exactly what a single log line cannot tell an operator",
  );
});

test("GET /api/telemetry exposes the live stats as machine-readable JSON", async () => {
  const throwingPg: Queryable = {
    query: async () => {
      throw new Error("FATAL");
    },
  };
  await writeAdmittedRows(throwingPg, [makeRow("f")]);

  const res = await GET();
  const body = (await res.json()) as { droppedCount: number; lastDroppedAt: string | null; poolConfigured: boolean };

  assert.equal(body.droppedCount, 1);
  assert.notEqual(body.lastDroppedAt, null);
  assert.equal(typeof body.poolConfigured, "boolean");
});

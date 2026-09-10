import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { writeAdmittedRows } from "../../src/app/api/telemetry/route";
import type { Queryable } from "../../src/lib/pg/pool";
import type { TelemetryRow } from "../../src/lib/telemetry/types";

/**
 * THE MEASURED DEFECT (prod DB box, 2026-09-09): `insertRows`'s
 * `on conflict (event_id) do nothing` names an inference target, and
 * Postgres requires SELECT on any column named there. `telemetry_pg` is
 * insert-only by design (no SELECT grant — deploy/db-box/telemetry-schema.sql),
 * so every real ingest write was silently denied/dropped in production while
 * `deploy/db-box/verify-telemetry-grants.sh` kept reporting the grants as
 * healthy — it proved insert with a plain INSERT, a different statement
 * shape from the one route.ts actually sends. The class bug is a verifier
 * that never exercises the app's real statement.
 *
 * These two tests cover both ends of that class: the app's actual SQL (via
 * `writeAdmittedRows`, the same exported chokepoint
 * `telemetry-route-ingest-drop-marker.test.ts` drives with a fake
 * `Queryable`), and the verifier script staying in lockstep with it so the
 * two cannot silently drift apart again.
 */

function makeRow(id: string): TelemetryRow {
  return {
    event_id: id,
    occurred_at: new Date().toISOString(),
    session_id: "s1",
    visitor_id: null,
    user_id: null,
    event_name: "test_event",
    source: null,
    query_id: null,
    job_id: null,
    company_domain: null,
    position: null,
    props: {},
  };
}

test("insertRows (via writeAdmittedRows) sends ON CONFLICT DO NOTHING with no inference target", async () => {
  const calls: string[] = [];
  const pg: Queryable = {
    query: async (sql: string) => {
      calls.push(sql);
      return { rows: [] };
    },
  };

  await writeAdmittedRows(pg, [makeRow("a")]);

  assert.equal(calls.length, 1, "exactly one insert statement must be sent");
  const sql = calls[0].trim();
  assert.match(sql, /on conflict do nothing$/i, "must end with a bare ON CONFLICT DO NOTHING");
  assert.doesNotMatch(
    sql,
    /on conflict\s*\(/i,
    "must never name an inference target — telemetry_pg has no SELECT grant to support one",
  );
});

test("verify-telemetry-grants.sh's insert probe carries the identical ON CONFLICT DO NOTHING clause as the app", () => {
  const scriptPath = join(__dirname, "..", "..", "deploy", "db-box", "verify-telemetry-grants.sh");
  const script = readFileSync(scriptPath, "utf8");

  const probeLine = script
    .split("\n")
    .find((line) =>
      line.includes(
        "insert into intervu.telemetry_events (event_id, occurred_at, session_id, event_name) values",
      ),
    );

  assert.ok(probeLine, "verify-telemetry-grants.sh must still contain the telemetry_pg insert probe statement");
  assert.match(
    probeLine!,
    /on conflict do nothing/i,
    "the verifier's probe must exercise the app's real ON CONFLICT DO NOTHING clause, not a plain INSERT",
  );
  assert.doesNotMatch(
    probeLine!,
    /on conflict\s*\(/i,
    "the verifier must not silently regress to naming an inference target the app doesn't use",
  );
});

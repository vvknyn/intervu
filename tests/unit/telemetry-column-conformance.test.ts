import { test } from "node:test";
import assert from "node:assert/strict";
import { LEDGER_COLUMN_RULES, type LedgerColumnName } from "../../src/lib/telemetry/column-rules";
import { processBatch } from "../../src/lib/telemetry/ingest";
import { TELEMETRY_COLUMNS } from "../../src/app/api/telemetry/route";

/**
 * `LEDGER_COLUMN_RULES` (`column-rules.ts`) is meant to be the single source
 * of truth for both sides of the ledger admission contract. The CLIENT
 * consumes it generically (`client.ts`'s `extractLedgerColumns` iterates
 * `Object.keys(...)`), but the SERVER names all 5 columns by hand three
 * times over (`ingest.ts`'s guard chain, `ingest.ts`'s row builder, and
 * `route.ts`'s `TELEMETRY_COLUMNS`). A 6th entry added to the table would
 * silently vanish server-side with no test failure — this file is that test.
 *
 * Every assertion below iterates `Object.keys(LEDGER_COLUMN_RULES)` — it
 * must never hardcode one of the 5 current column names, or it stops being
 * a conformance check the moment a 6th one is added.
 */

const NOW = Date.parse("2026-09-03T12:00:00Z");

let seq = 0;
function uuid(): string {
  seq += 1;
  return `${String(seq).padStart(8, "0")}-0000-4000-8000-000000000000`;
}

function baseEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_id: uuid(),
    occurred_at: new Date(NOW).toISOString(),
    session_id: uuid(),
    event_name: "job_viewed",
    ...overrides,
  };
}

/**
 * A generic pool of representative values, probed against each column's own
 * predicate to find one it accepts and one it rejects. Deliberately NOT
 * keyed to any column name or type — a predicate decides which of these it
 * likes, this list never decides on a predicate's behalf.
 */
const CANDIDATE_VALUES: readonly unknown[] = [
  "11111111-1111-4111-8111-111111111111",
  "plain string value",
  "",
  42,
  3.5,
  -7,
  true,
  false,
  {},
  [],
];

function findAccepted(predicate: (value: unknown) => boolean): unknown {
  const value = CANDIDATE_VALUES.find((v) => predicate(v));
  if (value === undefined) {
    throw new Error("no candidate value is accepted by this predicate — extend CANDIDATE_VALUES");
  }
  return value;
}

function findRejected(predicate: (value: unknown) => boolean): unknown {
  const value = CANDIDATE_VALUES.find((v) => !predicate(v));
  if (value === undefined) {
    throw new Error(
      "no candidate value is rejected by this predicate — either extend CANDIDATE_VALUES or this " +
        "column's predicate is too permissive to test",
    );
  }
  return value;
}

for (const key of Object.keys(LEDGER_COLUMN_RULES) as LedgerColumnName[]) {
  const predicate = LEDGER_COLUMN_RULES[key];

  test(`${key}: a value its predicate accepts round-trips through processBatch under the same key`, () => {
    const value = findAccepted(predicate);
    const eventId = uuid();
    const { rows, rejections } = processBatch([baseEvent({ event_id: eventId, [key]: value })], NOW);

    assert.equal(rejections.length, 0, `expected no rejections, got ${JSON.stringify(rejections)}`);
    assert.equal(rows.length, 1);
    assert.deepEqual((rows[0] as unknown as Record<string, unknown>)[key], value, `row.${key} did not carry the accepted value through`);
  });

  test(`${key}: a value its predicate rejects fails the whole event as invalid_shape`, () => {
    const value = findRejected(predicate);
    const eventId = uuid();
    const { rows, rejections } = processBatch([baseEvent({ event_id: eventId, [key]: value })], NOW);

    assert.equal(rows.length, 0, `expected the malformed ${key} to reject the event, but it produced a row`);
    assert.deepEqual(rejections, [{ event_id: eventId, reason: "invalid_shape" }]);
  });

  test(`${key}: is present in route.ts's TELEMETRY_COLUMNS insert list`, () => {
    assert.equal(
      (TELEMETRY_COLUMNS as readonly string[]).includes(key),
      true,
      `${key} is in LEDGER_COLUMN_RULES but missing from TELEMETRY_COLUMNS — it would validate but never be inserted`,
    );
  });
}

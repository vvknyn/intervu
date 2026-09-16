import { test } from "node:test";
import assert from "node:assert/strict";
import { extractLedgerColumns, randomUuidFallback } from "../../src/lib/telemetry/client";
import { UUID_PATTERN, LEDGER_COLUMN_RULES, type LedgerColumnName } from "../../src/lib/telemetry/column-rules";
import { processBatch } from "../../src/lib/telemetry/ingest";

/**
 * Defect 1 (ledger columns sent nested in `props`) and Defect 3 (the
 * non-UUID fallback silently dropping every event from browsers without
 * `crypto.randomUUID`) — see the telemetry integration brief. Both bugs
 * were invisible from the wire shape alone: the server rejects malformed
 * events silently (`invalid_shape`), so a wrong client-side decision here
 * never surfaces anywhere except a permanently-null column or a vanished
 * event stream.
 *
 * Defect 4 (this file's newest additions below): `client.ts` used to admit
 * the 5 promoted ledger columns with a bare `typeof` check while
 * `ingest.ts` enforced the real predicate (UUID format, integer-ness) —
 * two DIFFERENT kinds of validation that could (and did) disagree, silently
 * discarding a whole event server-side that the client thought was fine.
 * Both sides now import the identical predicate table (`LEDGER_COLUMN_RULES`,
 * `./column-rules`), so the tests below prove agreement structurally rather
 * than by re-deriving the rules a second time.
 */

const VALID_UUID = "11111111-1111-1111-1111-111111111111";
const NOW = Date.parse("2026-09-03T12:00:00Z");

test("extractLedgerColumns promotes a string field and the numeric field without mutating the input", () => {
  const original = { job_id: "job-123", position: 4, other: "kept" };
  const input = { ...original };

  const { columns, props } = extractLedgerColumns(input);

  assert.deepEqual(columns, { job_id: "job-123", position: 4 });
  assert.equal("job_id" in props, false);
  assert.equal("position" in props, false);
  assert.deepEqual(props, { other: "kept" });

  // The ORIGINAL object passed in must be untouched — `captureEvent` hands
  // this same reference to `posthog.capture(...)` right before calling
  // `trackToLedger`, so PostHog still needs to see every key it was given.
  assert.deepEqual(input, original);
  assert.equal(Object.prototype.hasOwnProperty.call(input, "job_id"), true);
  assert.equal(Object.prototype.hasOwnProperty.call(input, "position"), true);
});

test("a wrong-typed value is dropped from both columns and props, not forwarded either way", () => {
  const { columns, props } = extractLedgerColumns({
    position: "3", // should be a number per the DDL
    job_id: 42, // should be a string per the DDL
    query_id: VALID_UUID, // correctly typed AND a valid uuid, promoted normally
  });

  assert.deepEqual(columns, { query_id: VALID_UUID });
  assert.equal("position" in columns, false);
  assert.equal("job_id" in columns, false);
  assert.equal("position" in props, false, "a malformed value must not silently reach props either");
  assert.equal("job_id" in props, false);
});

test("randomUuidFallback produces a valid, non-constant v4 UUID", () => {
  const first = randomUuidFallback();
  const second = randomUuidFallback();

  assert.match(first, UUID_PATTERN);
  assert.match(second, UUID_PATTERN);
  assert.notEqual(first, second, "two calls must not return the same hardcoded value");
});

// --- column-admission contract (the actual defect this file guards) -------

test("a well-typed but non-UUID query_id is dropped by extractLedgerColumns, from both columns and props", () => {
  const { columns, props } = extractLedgerColumns({ query_id: "not-a-uuid", other: "kept" });

  assert.equal("query_id" in columns, false);
  assert.equal("query_id" in props, false);
  assert.deepEqual(props, { other: "kept" });
});

test("a non-integer position is dropped by extractLedgerColumns (second instance of the same class of bug)", () => {
  const { columns, props } = extractLedgerColumns({ position: 3.7, other: "kept" });

  assert.equal("position" in columns, false);
  assert.equal("position" in props, false);
  assert.deepEqual(props, { other: "kept" });
});

test("a valid UUID query_id and integer positions (including 0 and negative) are promoted into columns", () => {
  const zero = extractLedgerColumns({ query_id: VALID_UUID, position: 0 });
  assert.deepEqual(zero.columns, { query_id: VALID_UUID, position: 0 });

  const negative = extractLedgerColumns({ query_id: VALID_UUID, position: -7 });
  assert.deepEqual(negative.columns, { query_id: VALID_UUID, position: -7 });
});

/**
 * The class-level guard. Every cell below is an independently-known correct
 * answer for one (column, value) pair — not re-derived from the predicate
 * under test. Each cell is then checked three ways:
 *   1. `LEDGER_COLUMN_RULES[column](value)` — the shared predicate itself.
 *   2. `extractLedgerColumns` — the client's real admission path.
 *   3. `processBatch` — `ingest.ts`'s real, server-side admission path, via
 *      a full otherwise-valid event with only this one field varied.
 * All three must agree with the hardcoded expectation, which is the whole
 * point of collapsing two decision functions into one: agreement is now
 * structural (same function reference on both sides), and this test proves
 * that reference is actually wired into both real call paths, not just
 * checked against itself.
 */
const CASES: { column: LedgerColumnName; value: unknown; expected: boolean; label: string }[] = [
  { column: "query_id", value: VALID_UUID, expected: true, label: "valid uuid" },
  { column: "query_id", value: "not-a-uuid", expected: false, label: "invalid-format uuid string" },
  { column: "query_id", value: 123, expected: false, label: "non-string" },
  { column: "query_id", value: null, expected: true, label: "null" },
  { column: "query_id", value: undefined, expected: true, label: "undefined" },

  { column: "source", value: "serp", expected: true, label: "valid string" },
  { column: "source", value: 123, expected: false, label: "non-string" },
  { column: "source", value: null, expected: true, label: "null" },

  { column: "job_id", value: "job-42", expected: true, label: "valid string" },
  { column: "job_id", value: 123, expected: false, label: "non-string" },

  { column: "company_domain", value: "acme.com", expected: true, label: "valid string" },
  { column: "company_domain", value: true, expected: false, label: "non-string" },

  { column: "position", value: 5, expected: true, label: "valid integer" },
  { column: "position", value: -7, expected: true, label: "valid negative integer" },
  { column: "position", value: 0, expected: true, label: "valid zero integer" },
  { column: "position", value: 3.7, expected: false, label: "non-integer number" },
  { column: "position", value: "5", expected: false, label: "non-number" },
  { column: "position", value: null, expected: true, label: "null" },
  { column: "position", value: undefined, expected: true, label: "undefined" },
];

function baselineEvent(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    event_id: VALID_UUID,
    session_id: "22222222-2222-2222-2222-222222222222",
    event_name: "test_event",
    occurred_at: new Date(NOW).toISOString(),
    ...overrides,
  };
}

test("client (extractLedgerColumns) and server (processBatch) admission agree, per column, via the one shared predicate table", () => {
  for (const { column, value, expected, label } of CASES) {
    const ruleResult = LEDGER_COLUMN_RULES[column](value);
    assert.equal(ruleResult, expected, `LEDGER_COLUMN_RULES.${column} on ${label}`);

    const { columns: clientColumns } = extractLedgerColumns({ [column]: value });
    assert.equal(
      Object.prototype.hasOwnProperty.call(clientColumns, column),
      expected,
      `client extractLedgerColumns.${column} on ${label}`,
    );

    const raw = baselineEvent({ [column]: value });
    const { rows } = processBatch([raw], NOW);
    assert.equal(rows.length === 1, expected, `server processBatch.${column} on ${label}`);
  }
});

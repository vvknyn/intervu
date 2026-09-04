import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
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

/**
 * §0 of `deploy/db-box/telemetry-schema.sql` (owned by another lane — READ
 * ONLY) is the single source of truth for the ledger table's actual SQL
 * column types: a drift guard that fails the migration if Postgres's
 * `information_schema.columns` disagrees with this literal `name:data_type`
 * array. We parse THAT array rather than re-declaring the contract here, so
 * this test cannot drift from the schema independently of it.
 *
 * This closes the gap the round-trip tests above cannot: `processBatch`
 * only proves a predicate accepts/rejects SOME value, never that the value
 * it accepts is actually shaped like the column's declared SQL type. A
 * predicate that has been silently widened (e.g. an integer column whose TS
 * guard now accepts strings) still round-trips a well-typed value through
 * `processBatch` with zero test failures — the SQL insert is what would
 * throw, in prod, at 2am, and route.ts swallows that into a 204.
 */
function loadExpectedSqlColumns(): ReadonlyMap<string, string> {
  const schemaPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../deploy/db-box/telemetry-schema.sql",
  );

  let sql: string;
  try {
    sql = readFileSync(schemaPath, "utf8");
  } catch (err) {
    throw new Error(
      `telemetry-column-conformance: could not read ${schemaPath} to determine declared SQL column ` +
        `types — refusing to silently skip the type-conformance checks. ${(err as Error).message}`,
    );
  }

  const arrayLiteral = sql.match(/expected_columns\s+text\[\]\s*:=\s*array\[([\s\S]*?)\]/);
  if (!arrayLiteral) {
    throw new Error(
      `telemetry-column-conformance: could not find "expected_columns text[] := array[...]" in ` +
        `${schemaPath} — the §0 drift guard's shape has changed; update this test's parser to match ` +
        "it rather than skipping the type-conformance checks.",
    );
  }

  const entries = [...arrayLiteral[1].matchAll(/'([^':]+):([^']+)'/g)];
  if (entries.length === 0) {
    throw new Error(
      `telemetry-column-conformance: parsed 0 "name:type" entries out of expected_columns in ` +
        `${schemaPath} — the array literal's format has changed; update this test's parser to match ` +
        "it rather than skipping the type-conformance checks.",
    );
  }

  const columns = new Map<string, string>();
  for (const [, name, sqlType] of entries) columns.set(name, sqlType);
  return columns;
}

const EXPECTED_SQL_COLUMNS = loadExpectedSqlColumns();

/**
 * Compatibility keyed strictly by SQL TYPE, never by column name — so a 6th
 * ledger column reusing one of these types is covered by construction, and
 * a genuinely new SQL type fails loudly (below) instead of silently passing.
 */
const SQL_TYPE_COMPAT: Readonly<Record<string, { accepts: unknown; rejects: unknown }>> = {
  uuid: { accepts: "11111111-1111-4111-8111-111111111111", rejects: "not-a-uuid-string" },
  text: { accepts: "a representative text value", rejects: 12345 },
  integer: { accepts: 42, rejects: "42" },
  bigint: { accepts: 42, rejects: "42" },
  jsonb: { accepts: { nested: true }, rejects: "not-an-object" },
  "timestamp with time zone": { accepts: new Date(NOW).toISOString(), rejects: 42 },
};

for (const key of Object.keys(LEDGER_COLUMN_RULES) as LedgerColumnName[]) {
  test(`${key}: is declared in telemetry-schema.sql's expected_columns contract`, () => {
    assert.ok(
      EXPECTED_SQL_COLUMNS.has(key),
      `${key} is a LEDGER_COLUMN_RULES key but is absent from deploy/db-box/telemetry-schema.sql's ` +
        "expected_columns array — a ledger column with no declared SQL type is its own bug.",
    );
  });

  test(`${key}: predicate's accept/reject shape matches its declared SQL type`, () => {
    const sqlType = EXPECTED_SQL_COLUMNS.get(key);
    if (!sqlType) {
      throw new Error(`${key}: no declared SQL type found in expected_columns — see the previous test`);
    }

    const compat = SQL_TYPE_COMPAT[sqlType];
    if (!compat) {
      throw new Error(
        `telemetry-column-conformance: SQL type "${sqlType}" (declared for ${key}) has no entry in ` +
          "SQL_TYPE_COMPAT — extend that closed set, keyed by TYPE, never by column name.",
      );
    }

    const predicate = LEDGER_COLUMN_RULES[key];

    assert.equal(
      predicate(compat.accepts),
      true,
      `${key}'s predicate must accept a representative ${sqlType} value ` +
        `(${JSON.stringify(compat.accepts)}) — if this fails, the TS predicate has drifted narrower ` +
        `than its declared SQL type ${sqlType}`,
    );
    assert.equal(
      predicate(compat.rejects),
      false,
      `${key}'s predicate must reject a value incompatible with its declared SQL type ${sqlType} ` +
        `(${JSON.stringify(compat.rejects)}) — if this fails, the TS predicate has drifted WIDER than ` +
        `its declared SQL type ${sqlType} and a real INSERT would now throw for accepted values`,
    );
  });
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

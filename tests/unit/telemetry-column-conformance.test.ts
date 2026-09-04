import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  ENVELOPE_COLUMN_RULES,
  LEDGER_COLUMN_EXEMPTIONS,
  LEDGER_COLUMN_RULES,
  type LedgerColumnName,
} from "../../src/lib/telemetry/column-rules";
import { processBatch } from "../../src/lib/telemetry/ingest";
import { TELEMETRY_COLUMNS } from "../../src/app/api/telemetry/route";
import { buildJobFeaturesSelect, JOB_FEATURES_TIMESTAMP_COLUMNS } from "../../src/lib/telemetry/job-features-columns";

/**
 * `column-rules.ts` is meant to be the single source of truth for the
 * ledger admission contract, split into three maps: `LEDGER_COLUMN_RULES`
 * (the 5 columns promoted out of `props`), `ENVELOPE_COLUMN_RULES` (the
 * columns every event carries at the wire's top level), and
 * `LEDGER_COLUMN_EXEMPTIONS` (columns with no client predicate, each with a
 * reason). The CLIENT consumes `LEDGER_COLUMN_RULES` generically
 * (`client.ts`'s `extractLedgerColumns` iterates `Object.keys(...)`).
 *
 * The type-agreement loop below iterates every column
 * `telemetry-schema.sql`'s `expected_columns` declares — not just
 * `LEDGER_COLUMN_RULES`'s 5 — and resolves each one to whichever of the
 * three maps accounts for it. A column declared in the schema but absent
 * from all three fails loudly instead of silently skipping every assertion,
 * which is exactly what let `visitor_id:uuid` drift to `visitor_id:text`
 * with zero test failures before this file existed.
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

type ColumnResolution =
  | { kind: "predicate"; predicate: (value: unknown) => boolean }
  | { kind: "exempt"; reason: string };

/**
 * Which of the three `column-rules.ts` maps accounts for one SQL-declared
 * column — matched on MAP MEMBERSHIP, never on the column's name, so a 15th
 * declared column with no entry anywhere resolves to neither branch and the
 * caller below fails loudly instead of iterating over a set that quietly
 * excludes it.
 */
function resolveColumn(key: string): ColumnResolution | undefined {
  const ledgerRules = LEDGER_COLUMN_RULES as Record<string, (value: unknown) => boolean>;
  const envelopeRules = ENVELOPE_COLUMN_RULES as Record<string, (value: unknown) => boolean>;
  const hits = [key in ledgerRules, key in envelopeRules, key in LEDGER_COLUMN_EXEMPTIONS].filter(Boolean).length;

  if (hits > 1) {
    throw new Error(
      `telemetry-column-conformance: "${key}" is declared in more than one of LEDGER_COLUMN_RULES, ` +
        "ENVELOPE_COLUMN_RULES, and LEDGER_COLUMN_EXEMPTIONS — a column's admission rule must live in " +
        "exactly one of those maps.",
    );
  }
  if (key in ledgerRules) return { kind: "predicate", predicate: ledgerRules[key] };
  if (key in envelopeRules) return { kind: "predicate", predicate: envelopeRules[key] };
  if (key in LEDGER_COLUMN_EXEMPTIONS) return { kind: "exempt", reason: LEDGER_COLUMN_EXEMPTIONS[key] };
  return undefined;
}

// Driven by the SQL contract's own declared columns, not by
// `LEDGER_COLUMN_RULES` — this is what makes a 15th column force a decision
// instead of vanishing from every assertion below.
for (const key of EXPECTED_SQL_COLUMNS.keys()) {
  const resolution = resolveColumn(key);

  test(`${key}: resolves to exactly one of LEDGER_COLUMN_RULES / ENVELOPE_COLUMN_RULES / LEDGER_COLUMN_EXEMPTIONS`, () => {
    assert.ok(
      resolution !== undefined,
      `${key} is declared in telemetry-schema.sql's expected_columns but is absent from ` +
        "LEDGER_COLUMN_RULES, ENVELOPE_COLUMN_RULES, AND LEDGER_COLUMN_EXEMPTIONS in column-rules.ts — " +
        "a new column must add a predicate (if client-suppliable) or an exemption with a reason (if not); " +
        "it cannot land unchecked.",
    );
  });

  if (resolution === undefined) continue;

  if (resolution.kind === "exempt") {
    test(`${key}: has no client predicate, exempted with a stated reason`, () => {
      assert.equal(typeof resolution.reason, "string");
      assert.ok(
        resolution.reason.trim().length > 0,
        `${key}'s LEDGER_COLUMN_EXEMPTIONS entry must explain why it has no predicate`,
      );
    });
    continue;
  }

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

    const { predicate } = resolution;

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

/**
 * job_features timestamp read-back: `buildJobFeaturesSelect` (pure, no DB
 * handle — see its own doc comment) must project every
 * `JOB_FEATURES_TIMESTAMP_COLUMNS` entry through the `to_char(... AT TIME
 * ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')` cast, never a bare
 * `::text`. A bare `::text` on a `timestamptz` renders Postgres's own text
 * form — session-`DateStyle`-dependent, space-separated, numeric offset
 * (e.g. "2026-09-04 09:41:11.639+02") — which is NOT the ISO-8601 string
 * `extractJobFeatures` (features.ts) writes via `toISOString()`. Verified
 * empirically against a live local Postgres 18.3 instance during
 * development (unaffected by session DateStyle/TimeZone GUCs):
 *   to_char(('2026-09-04T07:41:11.639Z'::timestamptz) AT TIME ZONE 'UTC',
 *     'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') -> '2026-09-04T07:41:11.639Z'
 *   to_char(('...11.000+02'::timestamptz) AT TIME ZONE 'UTC', same fmt)
 *     -> '2026-09-04T07:41:11.000Z'  (MS always zero-pads to 3 digits)
 */
const SPACE_OFFSET_SHAPE_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+[+-]\d{2}(:\d{2})?$/;

/**
 * Independent re-implementation of the to_char cast above — built from UTC
 * field accessors and manual zero-padding, NOT by calling toISOString()
 * again, so a drift in the SQL's format string (wrong digit count, missing
 * "T"/"Z" literal, wrong field order) is something this can actually catch
 * rather than a tautology that restates the answer.
 */
function postgresIsoCast(instantIso: string): string {
  const d = new Date(instantIso);
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}` +
    `.${pad(d.getUTCMilliseconds(), 3)}Z`
  );
}

test("negative-control: the space-offset matcher actually detects the old broken shape before we trust its absence", () => {
  assert.match("2026-09-04 09:41:11.639+02", SPACE_OFFSET_SHAPE_RE);
  assert.doesNotMatch("2026-09-04T07:41:11.639Z", SPACE_OFFSET_SHAPE_RE);
});

test("every JOB_FEATURES_TIMESTAMP_COLUMNS entry projects via to_char(... AT TIME ZONE 'UTC' ...), never a bare ::text cast", () => {
  const { text } = buildJobFeaturesSelect(["job-1"]);
  assert.ok(JOB_FEATURES_TIMESTAMP_COLUMNS.length > 0, "the class-wide loop below would silently check nothing if this list were empty");

  for (const col of JOB_FEATURES_TIMESTAMP_COLUMNS) {
    assert.doesNotMatch(
      text,
      new RegExp(`\\b${col}::text\\b`),
      `${col}: still uses the bare ::text cast, which renders Postgres's space-separated numeric-offset ` +
        `text form (e.g. "2026-09-04 09:41:11.639+02"), not ISO-8601`,
    );
    assert.match(
      text,
      new RegExp(`to_char\\(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS\\.MS"Z"'\\) as ${col}`),
      `${col}: projection must use the to_char(...) UTC ISO-8601 cast`,
    );
  }
});

test("the to_char format the projection targets is byte-identical to toISOString(), including a whole-second (zero-ms) instant", () => {
  for (const iso of ["2026-09-04T07:41:11.639Z", "2026-09-04T07:41:11.000Z", "2026-12-31T23:59:59.005Z"]) {
    assert.equal(postgresIsoCast(iso), iso, `${iso} did not round-trip byte-identically through the modeled to_char cast`);
    assert.doesNotMatch(postgresIsoCast(iso), SPACE_OFFSET_SHAPE_RE);
  }
});

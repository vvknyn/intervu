import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TELEMETRY_LEDGER_FIELDS_DISCLOSED } from "../../src/lib/telemetry/public-disclosure";
import { TELEMETRY_COLUMNS } from "../../src/app/api/telemetry/route";

function loadExpectedSqlColumnNames(): string[] {
  const schemaPath = join(__dirname, "../../deploy/db-box/telemetry-schema.sql");
  const sql = readFileSync(schemaPath, "utf8");
  const arrayLiteral = sql.match(/expected_columns\s+text\[\]\s*:=\s*array\[([\s\S]*?)\]/);
  assert.ok(arrayLiteral, "expected_columns array in telemetry-schema.sql");
  const entries = [...arrayLiteral[1].matchAll(/'([^':]+):([^']+)'/g)];
  return entries.map(([, name]) => name);
}

test("TELEMETRY_LEDGER_FIELDS_DISCLOSED matches DDL columns except internal id", () => {
  const ddl = loadExpectedSqlColumnNames();
  const publicColumns = ddl.filter((c) => c !== "id").sort();
  const disclosed = [...TELEMETRY_LEDGER_FIELDS_DISCLOSED].sort();
  assert.deepEqual(disclosed, publicColumns);
});

test("TELEMETRY_LEDGER_FIELDS_DISCLOSED covers every insert column plus received_at", () => {
  for (const col of TELEMETRY_COLUMNS) {
    assert.ok(
      TELEMETRY_LEDGER_FIELDS_DISCLOSED.includes(col),
      `insert column ${col} missing from public disclosure list`,
    );
  }
  assert.ok(TELEMETRY_LEDGER_FIELDS_DISCLOSED.includes("received_at"));
  assert.equal(TELEMETRY_LEDGER_FIELDS_DISCLOSED.length, TELEMETRY_COLUMNS.length + 1);
});

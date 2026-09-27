/**
 * Public-facing behavioural-ledger field list for /privacy — not the React page.
 * Kept aligned with `TelemetryRow`, `TELEMETRY_COLUMNS`, and
 * `deploy/db-box/telemetry-schema.sql` `expected_columns` (see
 * tests/unit/telemetry-public-disclosure.test.ts).
 */
import type { TelemetryRow } from "./types";

/** Stored columns we name on /privacy. Omits internal `id`; includes DB-only `received_at`. */
export const TELEMETRY_LEDGER_FIELDS_DISCLOSED: readonly string[] = [
  "event_id",
  "occurred_at",
  "received_at",
  "session_id",
  "visitor_id",
  "user_id",
  "event_name",
  "source",
  "query_id",
  "job_id",
  "company_domain",
  "position",
  "props",
] as const;

type DisclosedField = (typeof TELEMETRY_LEDGER_FIELDS_DISCLOSED)[number];
type RowField = keyof TelemetryRow;

/** Every insertable row field plus `received_at` must appear in the disclosure list. */
type _RowFieldsDisclosed = RowField extends DisclosedField ? true : never;
type _ReceivedAtDisclosed = "received_at" extends DisclosedField ? true : never;
const _rowCoverage: _RowFieldsDisclosed = true;
const _receivedAtCoverage: _ReceivedAtDisclosed = true;
void _rowCoverage;
void _receivedAtCoverage;

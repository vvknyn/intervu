/**
 * The single admission contract for the ledger's columns (see
 * `deploy/db-box/telemetry-schema.sql`), split into three exported maps by
 * how a column's value is decided:
 *
 * - `LEDGER_COLUMN_RULES` — the 5 columns promoted out of a `captureEvent`'s
 *   `props` blob. Both `ingest.ts` (server, deciding whether a wire event's
 *   shape is acceptable) and `client.ts` (browser, deciding which props get
 *   promoted) import the SAME predicate per column from here, so the two
 *   sides cannot drift into disagreeing about what counts as a valid value
 *   — a defect that previously let the client admit a value (checked by
 *   bare `typeof`) that the server's real predicate then rejected, silently
 *   discarding the whole event.
 * - `ENVELOPE_COLUMN_RULES` — the columns every event must carry at the
 *   wire's top level (identity + name + payload), consumed only by
 *   `ingest.ts`'s `parseEvent`.
 * - `LEDGER_COLUMN_EXEMPTIONS` — columns with no wire-value predicate
 *   because none is possible: DB-generated, or resolved server-side from
 *   something other than the request body. Each entry names why, so the
 *   absence is asserted rather than silent (see
 *   `tests/unit/telemetry-column-conformance.test.ts`, which requires every
 *   column `telemetry-schema.sql` declares to resolve to exactly one of
 *   these three maps).
 *
 * ZERO IMPORTS: this file is bundled into the browser via `client.ts`, so it
 * must never pull in anything server-side (no `./ingest`, no `./types`).
 */

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isOptionalUuid(value: unknown): boolean {
  return value === null || value === undefined || isUuid(value);
}

export function isOptionalString(value: unknown): boolean {
  return value === null || value === undefined || typeof value === "string";
}

export function isOptionalInteger(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "number" && Number.isInteger(value));
}

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

/** `Date.parse` returning a real timestamp is the actual runtime check
 *  `parseEvent` needs for a `timestamp with time zone` column fed a wire
 *  string — matches the DDL's type more precisely than "is a string". */
export function isTimestampString(value: unknown): boolean {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `props` is optional-when-absent but, unlike the `isOptional*` helpers
 *  above, never accepts `null` — a `jsonb` column fed a JSON `null` is a
 *  different admitted value than "the field wasn't sent", and `ingest.ts`
 *  has never accepted the former. */
export function isOptionalPlainObject(value: unknown): boolean {
  return value === undefined || isPlainObject(value);
}

/** The 5 ledger columns and the one predicate each side must agree on. */
export const LEDGER_COLUMN_RULES = {
  query_id: isOptionalUuid,
  source: isOptionalString,
  job_id: isOptionalString,
  company_domain: isOptionalString,
  position: isOptionalInteger,
} as const satisfies Record<string, (value: unknown) => boolean>;

export type LedgerColumnName = keyof typeof LEDGER_COLUMN_RULES;

/**
 * The remaining client-suppliable columns — the envelope every event must
 * carry, as opposed to `LEDGER_COLUMN_RULES`' 5 columns promoted out of
 * `props`. `ingest.ts`'s `parseEvent` consumes this map instead of
 * re-declaring each check inline, so this stays the one place that decides
 * what shape each of these fields must be.
 */
export const ENVELOPE_COLUMN_RULES = {
  event_id: isUuid,
  occurred_at: isTimestampString,
  session_id: isUuid,
  visitor_id: isOptionalUuid,
  event_name: isString,
  props: isOptionalPlainObject,
} as const satisfies Record<string, (value: unknown) => boolean>;

/**
 * Columns `telemetry-schema.sql` declares with no wire-value predicate
 * above, because none is possible: each is either DB-generated (never
 * appears in a request body) or resolved server-side from something other
 * than the request body. A one-line reason per entry so a column with no
 * predicate is a visible, asserted decision, not a silent gap.
 */
export const LEDGER_COLUMN_EXEMPTIONS: Readonly<Record<string, string>> = {
  id: "DB-generated bigserial primary key — never present in a request body.",
  received_at: "DB default now() — must stay DB-clock-authoritative, never client-suppliable.",
  user_id:
    "stamped server-side from getServerUser() (route.ts); a client-suppliable user_id would let anyone poison another user's row (see types.ts's RawTelemetryEvent doc comment).",
};

/**
 * The single admission contract for the 5 promoted ledger columns
 * (`query_id`, `source`, `job_id`, `company_domain`, `position` — see
 * `deploy/db-box/telemetry-schema.sql`). Both `ingest.ts` (server, deciding
 * whether a wire event's shape is acceptable) and `client.ts` (browser,
 * deciding which `captureEvent` props get promoted out of the JSONB blob)
 * import the SAME predicate per column from here, so the two sides cannot
 * drift into disagreeing about what counts as a valid value — a defect that
 * previously let the client admit a value (checked by bare `typeof`) that
 * the server's real predicate then rejected, silently discarding the whole
 * event.
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

/** The 5 ledger columns and the one predicate each side must agree on. */
export const LEDGER_COLUMN_RULES = {
  query_id: isOptionalUuid,
  source: isOptionalString,
  job_id: isOptionalString,
  company_domain: isOptionalString,
  position: isOptionalInteger,
} as const satisfies Record<string, (value: unknown) => boolean>;

export type LedgerColumnName = keyof typeof LEDGER_COLUMN_RULES;

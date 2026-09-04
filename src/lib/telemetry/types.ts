/**
 * Wire types for the behavioural ledger (`intervu.telemetry_events`, see
 * `deploy/db-box/telemetry-schema.sql` for the DDL these mirror column for
 * column). Every lane that touches telemetry — the client emitter, the
 * ingest route, the nightly rollup, the reaper — imports the shapes here
 * rather than redeclaring them, so a column rename or a new rejection
 * reason has exactly one place to change.
 */

/** One event as the client sends it. `occurred_at` is the client clock and
 *  is NOT trusted — see `CLOCK_SKEW_WINDOW_MS` in `./ingest`. Every field
 *  the DDL types as `uuid` is carried as a string here; shape validation
 *  (ingest.ts) is what actually enforces the uuid format before a row is
 *  ever built. */
export interface RawTelemetryEvent {
  event_id: string;
  occurred_at: string;
  session_id: string;
  visitor_id?: string | null;
  user_id?: string | null;
  event_name: string;
  source?: string | null;
  query_id?: string | null;
  job_id?: string | null;
  company_domain?: string | null;
  position?: number | null;
  props?: Record<string, unknown>;
}

/** The POST /api/telemetry request body. */
export interface TelemetryBatchRequest {
  events: RawTelemetryEvent[];
}

/** A validated, normalised row — exactly the columns `insert` needs, in the
 *  DDL's own names. `id` and `received_at` are never set here: both have a
 *  database default (`bigserial`, `now()`), and `received_at` in particular
 *  must stay DB-clock-authoritative, not application-clock-authoritative. */
export interface TelemetryRow {
  event_id: string;
  occurred_at: string;
  session_id: string;
  visitor_id: string | null;
  user_id: string | null;
  event_name: string;
  source: string | null;
  query_id: string | null;
  job_id: string | null;
  company_domain: string | null;
  position: number | null;
  props: Record<string, unknown>;
}

/** Every reason a single event can fail to reach the ledger — produced by
 *  either `ingest.ts` (shape/name/size/duplicate) or `rate-limit.ts`
 *  (budget). One enum so a caller logging a drop never invents a second
 *  taxonomy for "why". */
export type TelemetryRejectionReason =
  | "invalid_shape"
  | "invalid_event_name"
  | "props_too_large"
  | "duplicate_event_id"
  | "rate_limited";

export interface TelemetryRejection {
  /** `null` when the event was too malformed to even have a usable id. */
  event_id: string | null;
  reason: TelemetryRejectionReason;
}

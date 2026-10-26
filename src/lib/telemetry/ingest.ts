/**
 * POST /api/telemetry — the pure half. Everything worth asserting on (shape
 * validation, the event-name allowlist-by-SHAPE, props-size dropping, clock
 * clamping, in-batch dedup, the bot-detection predicate) lives here as plain
 * functions over plain data, so none of it needs a Request, a database, or a
 * timer to test — same pure-decision/thin-I/O split as
 * `shouldLogSearch`/`recordSearch` (`lib/jobs/search-log.ts`). `route.ts` is
 * the only place that touches I/O: it's the one that reads the Request's
 * User-Agent header and calls `isBotUserAgent` with it.
 *
 * Guard order mirrors SPEC §4 exactly (content-length lives in route.ts
 * since it reads the Request before any body parsing; everything else is
 * here):
 *   2. batch length > MAX_BATCH_SIZE -> caller returns 400
 *   3. oversized props -> drop that event only
 *   4. event_name shape + allowlist (ANALYTICS_EVENTS wire names)
 *   5. occurred_at outside the clock-skew window -> clamp + flag, never drop
 *   (in-batch duplicate event_id -> drop the repeat, keep the first)
 */
import { ANALYTICS_EVENTS } from "@/lib/analytics/event-names";
import { scrubValue } from "@/lib/analytics/scrub-url-queries";
import { SEARCH_ENGINE_BOTS, AI_ANSWER_ENGINE_BOTS } from "@/lib/shield/robots-policy";
import type { TelemetryRejection, TelemetryRow } from "./types";
import { ENVELOPE_COLUMN_RULES, isPlainObject, LEDGER_COLUMN_RULES } from "./column-rules";

/** Guard 1 (route.ts): Content-Length absent or over this -> 413, no parse.
 *  Sized against the container's `mem_limit: 1g` (docker-compose.yml:22) —
 *  this is the single app container, so an unbounded body is an OOM of the
 *  whole site, not just this endpoint. */
export const MAX_BODY_BYTES = 65_536;

/** Guard 2: a batch bigger than this is rejected outright (400), not trimmed. */
export const MAX_BATCH_SIZE = 50;

/** Guard 3: `JSON.stringify(props).length` over this drops only that event. */
export const MAX_PROPS_LENGTH = 4096;

/** Guard 4: snake_case shape, then membership in the product analytics wire
 *  vocabulary (`ANALYTICS_EVENTS`). Client ledger events flow through
 *  `captureEvent` → `trackToLedger`, which only ever emits those values. */
export const EVENT_NAME_PATTERN = /^[a-z][a-z0-9_]{2,63}$/;

export const ALLOWED_TELEMETRY_EVENT_NAMES = new Set<string>(Object.values(ANALYTICS_EVENTS));

/** Guard 5: `occurred_at` further than this from server `now` (either
 *  direction) is untrustworthy client-clock skew, not a real timestamp. */
export const CLOCK_SKEW_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Bot policy for the ledger, reusing the same named-crawler lists
 * `robots.ts` already maintains (`lib/shield/robots-policy.ts`) rather than
 * a second bot roster — those bots are welcomed on marketing pages but their
 * hits still don't belong in "which postings do people apply to" stats. The
 * generic tokens catch crawlers that never made that named list. Deliberately
 * narrow like `shouldBlockSuspiciousRequest`: this only drops the event
 * batch (silent 204), it never blocks a request the way the shield does.
 */
const NAMED_BOT_PATTERN = new RegExp(
  [...SEARCH_ENGINE_BOTS, ...AI_ANSWER_ENGINE_BOTS].join("|"),
  "i",
);
const GENERIC_BOT_PATTERN = /bot|spider|crawler/i;

export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  const ua = (userAgent ?? "").trim();
  if (!ua) return true;
  return NAMED_BOT_PATTERN.test(ua) || GENERIC_BOT_PATTERN.test(ua);
}

/** Guard 2, isolated so route.ts can 400 before running any per-event work. */
export function isBatchTooLarge(events: readonly unknown[]): boolean {
  return events.length > MAX_BATCH_SIZE;
}

type ParsedEvent = { row: TelemetryRow } | { rejection: TelemetryRejection };

/** Guards 3–5 for one event. Never throws — a malformed field just fails a
 *  shape check and becomes a rejection, the same as a missing one.
 *
 *  `userId` is the caller's identity as the SERVER resolved it (or `null`
 *  signed out) — never read off `raw`. A stray `user_id` property on the
 *  wire body is simply not looked at, by construction: there is no branch
 *  here that touches `raw.user_id`. */
function parseEvent(raw: unknown, now: number, userId: string | null): ParsedEvent {
  if (!isPlainObject(raw)) {
    return { rejection: { event_id: null, reason: "invalid_shape" } };
  }

  const eventId = ENVELOPE_COLUMN_RULES.event_id(raw.event_id) ? (raw.event_id as string) : null;

  const shapeOk =
    eventId !== null &&
    ENVELOPE_COLUMN_RULES.session_id(raw.session_id) &&
    ENVELOPE_COLUMN_RULES.event_name(raw.event_name) &&
    ENVELOPE_COLUMN_RULES.occurred_at(raw.occurred_at) &&
    ENVELOPE_COLUMN_RULES.visitor_id(raw.visitor_id) &&
    LEDGER_COLUMN_RULES.query_id(raw.query_id) &&
    LEDGER_COLUMN_RULES.source(raw.source) &&
    LEDGER_COLUMN_RULES.job_id(raw.job_id) &&
    LEDGER_COLUMN_RULES.company_domain(raw.company_domain) &&
    LEDGER_COLUMN_RULES.position(raw.position) &&
    ENVELOPE_COLUMN_RULES.props(raw.props);

  if (!shapeOk) {
    return { rejection: { event_id: eventId, reason: "invalid_shape" } };
  }

  const occurredAtMs = Date.parse(raw.occurred_at as string);
  const eventName = raw.event_name as string;

  // The ledger keeps addresses the way PostHog does: no query string, no hash (`scrubValue`).
  const props = scrubValue((raw.props as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;
  if (JSON.stringify(props).length > MAX_PROPS_LENGTH) {
    return { rejection: { event_id: eventId, reason: "props_too_large" } };
  }

  if (!EVENT_NAME_PATTERN.test(eventName)) {
    return { rejection: { event_id: eventId, reason: "invalid_event_name" } };
  }

  if (!ALLOWED_TELEMETRY_EVENT_NAMES.has(eventName)) {
    return { rejection: { event_id: eventId, reason: "unknown_event_name" } };
  }

  const skewed = Math.abs(now - occurredAtMs) > CLOCK_SKEW_WINDOW_MS;

  return {
    row: {
      event_id: eventId,
      occurred_at: new Date(skewed ? now : occurredAtMs).toISOString(),
      session_id: raw.session_id as string,
      visitor_id: (raw.visitor_id as string | null | undefined) ?? null,
      user_id: userId,
      event_name: eventName,
      source: (raw.source as string | null | undefined) ?? null,
      query_id: (raw.query_id as string | null | undefined) ?? null,
      job_id: (raw.job_id as string | null | undefined) ?? null,
      company_domain: (raw.company_domain as string | null | undefined) ?? null,
      position: (raw.position as number | null | undefined) ?? null,
      props: skewed ? { ...props, clock_skew: true } : props,
    },
  };
}

/**
 * The one comparator for "consistent multi-row upsert order" — unsorted
 * multi-row upserts caused 7,318 deadlocks in this codebase's history.
 * Exported so `route.ts` can re-apply it after `partitionByRateLimit`
 * regroups rows by session_id (which does not preserve this order) instead
 * of hand-rolling a second copy of the same comparator right before insert.
 */
export function sortByEventId<T extends { event_id: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => (a.event_id < b.event_id ? -1 : a.event_id > b.event_id ? 1 : 0));
}

export interface ProcessBatchResult {
  /** Accepted rows, sorted by `event_id` — multi-row upserts must be
   *  consistently ordered (unsorted multi-row upserts caused 7,318
   *  deadlocks in this codebase's history); sorting here means `route.ts`
   *  never has to remember to. */
  rows: TelemetryRow[];
  rejections: TelemetryRejection[];
}

/**
 * Runs guards 3–5 over every event in the batch, then drops later
 * occurrences of a repeated `event_id` within the SAME batch (the
 * cross-request case — a retried beacon — is handled by `ON CONFLICT (event_id)
 * DO NOTHING` at insert time; this only covers one client batching the same
 * event twice before it ever reaches the network).
 *
 * `userId` is stamped onto every row in the batch — one request carries one
 * resolved identity (or none), never a per-event one — as the route's
 * `getServerUser()` result, `null` when signed out. Defaults to `null` so
 * callers that don't pass it (existing tests) get exactly today's
 * signed-out behaviour.
 */
export function processBatch(events: readonly unknown[], now: number, userId: string | null = null): ProcessBatchResult {
  const rows: TelemetryRow[] = [];
  const rejections: TelemetryRejection[] = [];
  const seen = new Set<string>();

  for (const raw of events) {
    const parsed = parseEvent(raw, now, userId);
    if ("rejection" in parsed) {
      rejections.push(parsed.rejection);
      continue;
    }
    if (seen.has(parsed.row.event_id)) {
      rejections.push({ event_id: parsed.row.event_id, reason: "duplicate_event_id" });
      continue;
    }
    seen.add(parsed.row.event_id);
    rows.push(parsed.row);
  }

  return { rows: sortByEventId(rows), rejections };
}

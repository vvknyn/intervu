/**
 * Per-session sliding-window rate limit for POST /api/telemetry (SPEC §4
 * guard 7: 200 events/min/session_id). In-process Map, no new dependency —
 * same deployment fact `lib/shield/rate-limit.ts` documents (one
 * `intervu` container, so one process holds the whole window).
 *
 * Reuses that file's `checkRateLimitWindow` pure decision rather than a
 * second rate-limit algorithm (single source of truth for "is this next
 * timestamp inside the cap") — this file only adds its own store, because a
 * telemetry session is its own concern, not `allowSearchRequest`'s or any
 * other chokepoint's counter (same reasoning every store in that file
 * already documents for not sharing).
 */
import { checkRateLimitWindow } from "@/lib/shield/rate-limit";
import type { TelemetryRejection, TelemetryRow } from "./types";

export const TELEMETRY_RATE_LIMIT_WINDOW_MS = 60_000;
export const TELEMETRY_RATE_LIMIT_MAX_EVENTS = 200;

const store = new Map<string, number[]>();

/**
 * Consumes up to `count` slots of `sessionId`'s budget at `now`, admitting
 * events in order until the cap is hit. Returns how many of the `count`
 * fit — the caller (`partitionByRateLimit`) uses that to keep the first N
 * rows for this session and reject the rest, rather than rejecting the
 * whole session's slice of the batch for one session going over budget.
 */
export function allowTelemetryEvents(sessionId: string, count: number, now: number): number {
  let timestamps = store.get(sessionId) ?? [];
  let admitted = 0;

  for (let i = 0; i < count; i++) {
    const result = checkRateLimitWindow(
      timestamps,
      now,
      TELEMETRY_RATE_LIMIT_WINDOW_MS,
      TELEMETRY_RATE_LIMIT_MAX_EVENTS,
    );
    timestamps = result.retained;
    if (!result.allowed) break;
    admitted++;
  }

  store.set(sessionId, timestamps);
  return admitted;
}

/**
 * Thin I/O: splits a batch's already-validated rows into what the per-session
 * budget admits vs. what it doesn't, without assuming one batch only ever
 * carries one session_id (each event is self-describing, so nothing prevents
 * a batch from mixing sessions, e.g. multiple tabs flushing near-simultaneously
 * behind a shared network layer).
 */
export function partitionByRateLimit(
  rows: readonly TelemetryRow[],
  now: number,
): { admitted: TelemetryRow[]; rejected: TelemetryRejection[] } {
  const bySession = new Map<string, TelemetryRow[]>();
  for (const row of rows) {
    const list = bySession.get(row.session_id);
    if (list) list.push(row);
    else bySession.set(row.session_id, [row]);
  }

  const admitted: TelemetryRow[] = [];
  const rejected: TelemetryRejection[] = [];
  for (const [sessionId, sessionRows] of bySession) {
    const admittedCount = allowTelemetryEvents(sessionId, sessionRows.length, now);
    admitted.push(...sessionRows.slice(0, admittedCount));
    for (const row of sessionRows.slice(admittedCount)) {
      rejected.push({ event_id: row.event_id, reason: "rate_limited" });
    }
  }
  return { admitted, rejected };
}

/** Test-only reset, mirroring `clearRateLimitStateForTests` in
 *  `lib/shield/rate-limit.ts` so cases don't leak state across each other. */
export function clearTelemetryRateLimitStateForTests(): void {
  store.clear();
}

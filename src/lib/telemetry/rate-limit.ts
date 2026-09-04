/**
 * Rate limits for POST /api/telemetry (SPEC §4 guard 7): a per-session
 * budget AND, independently, a per-IP one. In-process Maps, no new
 * dependency — same deployment fact `lib/shield/rate-limit.ts` documents
 * (one `intervu` container, so one process holds the whole window).
 *
 * Reuses that file's `checkRateLimitWindow` pure decision rather than a
 * second rate-limit algorithm (single source of truth for "is this next
 * timestamp inside the cap"), and its `sweepStale`/`SWEEP_THRESHOLD`
 * eviction rather than a third copy of that loop.
 *
 * Two budgets, not one: `session_id` is a value the CLIENT invents (it is
 * never authenticated), so rotating it per request bypasses a session-only
 * limit entirely. The IP-keyed budget below is enforced in addition to,
 * never instead of, the per-session one — see `partitionByRateLimit`.
 */
import { checkRateLimitWindow, sweepStale, SWEEP_THRESHOLD } from "@/lib/shield/rate-limit";
import type { TelemetryRejection, TelemetryRow } from "./types";

export const TELEMETRY_RATE_LIMIT_WINDOW_MS = 60_000;
export const TELEMETRY_RATE_LIMIT_MAX_EVENTS = 200;

/**
 * 10x the per-session cap. A household or office NATs many real visitors
 * behind one IP, so the IP budget has to clear "how many genuinely distinct
 * sessions could legitimately share an address" comfortably — 10 concurrent
 * fully-active sessions (each itself already generous per that constant's
 * own comment) covers a small office outright and a large one's realistic
 * concurrent-browsing slice, while still turning "rotate session_id
 * per request" from an unbounded bypass into a fixed, enforced ceiling.
 */
export const TELEMETRY_IP_RATE_LIMIT_MAX_EVENTS = TELEMETRY_RATE_LIMIT_MAX_EVENTS * 10;

/** Hard ceiling on distinct keys (session_ids, or IPs) tracked at once,
 *  independent of whether their window has expired — `sweepStale` alone
 *  only removes a key once its whole window has aged out, so a flood of
 *  freshly-rotated keys that are each still "in window" would otherwise
 *  grow a store without bound for the length of one window. Sized well
 *  under the container's `mem_limit: 1g` (docker-compose.yml:22): even the
 *  IP store's 2,000-entry-per-key budget caps out at
 *  20,000 * 2,000 timestamps * 8 bytes ≈ 320MB in the worst case, and real
 *  traffic never gets close to every tracked key being simultaneously
 *  maxed out. Eviction is oldest-inserted-first (`Map` preserves insertion
 *  order) — whatever has sat longest without a fresh sweep-triggering write
 *  is the safest guess for "no longer relevant". */
const MAX_TRACKED_KEYS = 20_000;

function evictOldest(store: Map<string, number[]>): void {
  while (store.size > MAX_TRACKED_KEYS) {
    const oldestKey = store.keys().next().value;
    if (oldestKey === undefined) break;
    store.delete(oldestKey);
  }
}

/**
 * One bounded, sliding-window "admit up to N of this key's next `count`
 * events" store — the mechanism both the per-session and per-IP budgets
 * below are, so a fix to eviction or windowing lands in one place instead
 * of two hand-copies of the same loop.
 */
function createEventBudget(windowMs: number, maxEvents: number) {
  const store = new Map<string, number[]>();

  /**
   * Consumes up to `count` slots of `key`'s budget at `now`, admitting
   * events in order until the cap is hit. Returns how many of the `count`
   * fit — callers use that to keep the first N and reject the rest, rather
   * than rejecting a whole slice for going over budget by any amount.
   */
  function allow(key: string, count: number, now: number): number {
    if (store.size > SWEEP_THRESHOLD) sweepStale(store, now, windowMs);
    evictOldest(store);

    let timestamps = store.get(key) ?? [];
    let admitted = 0;

    for (let i = 0; i < count; i++) {
      const result = checkRateLimitWindow(timestamps, now, windowMs, maxEvents);
      timestamps = result.retained;
      if (!result.allowed) break;
      admitted++;
    }

    store.set(key, timestamps);
    return admitted;
  }

  return { allow, clear: () => store.clear(), size: () => store.size };
}

const sessionBudget = createEventBudget(TELEMETRY_RATE_LIMIT_WINDOW_MS, TELEMETRY_RATE_LIMIT_MAX_EVENTS);
const ipBudget = createEventBudget(TELEMETRY_RATE_LIMIT_WINDOW_MS, TELEMETRY_IP_RATE_LIMIT_MAX_EVENTS);

/** Thin wrapper: `createEventBudget`'s per-session store. */
export function allowTelemetryEvents(sessionId: string, count: number, now: number): number {
  return sessionBudget.allow(sessionId, count, now);
}

/** Thin wrapper: `createEventBudget`'s per-IP store — see the module doc for
 *  why this exists alongside, not instead of, the per-session one. */
export function allowTelemetryEventsByIp(ip: string, count: number, now: number): number {
  return ipBudget.allow(ip, count, now);
}

/**
 * Thin I/O: splits a batch's already-validated rows into what the budgets
 * admit vs. don't, without assuming one batch only ever carries one
 * session_id (each event is self-describing, so nothing prevents a batch
 * from mixing sessions, e.g. multiple tabs flushing near-simultaneously
 * behind a shared network layer). `ip` is the one address the whole
 * request arrived from — one HTTP request, one client IP, regardless of
 * how many sessions its batch mixes.
 *
 * The per-session budget is checked first (a session over ITS OWN cap is
 * rejected regardless of the IP budget), then the IP budget is applied on
 * top of whatever the session pass admitted — so a session can never buy
 * its way past the IP-wide ceiling by arriving alongside other sessions.
 */
export function partitionByRateLimit(
  rows: readonly TelemetryRow[],
  now: number,
  ip: string,
): { admitted: TelemetryRow[]; rejected: TelemetryRejection[] } {
  const bySession = new Map<string, TelemetryRow[]>();
  for (const row of rows) {
    const list = bySession.get(row.session_id);
    if (list) list.push(row);
    else bySession.set(row.session_id, [row]);
  }

  const admittedBySession: TelemetryRow[] = [];
  const rejected: TelemetryRejection[] = [];
  for (const [sessionId, sessionRows] of bySession) {
    const admittedCount = allowTelemetryEvents(sessionId, sessionRows.length, now);
    admittedBySession.push(...sessionRows.slice(0, admittedCount));
    for (const row of sessionRows.slice(admittedCount)) {
      rejected.push({ event_id: row.event_id, reason: "rate_limited" });
    }
  }

  const admittedByIpCount = allowTelemetryEventsByIp(ip, admittedBySession.length, now);
  const admitted = admittedBySession.slice(0, admittedByIpCount);
  for (const row of admittedBySession.slice(admittedByIpCount)) {
    rejected.push({ event_id: row.event_id, reason: "rate_limited" });
  }

  return { admitted, rejected };
}

/** Test-only reset, mirroring `clearRateLimitStateForTests` in
 *  `lib/shield/rate-limit.ts` so cases don't leak state across each other. */
export function clearTelemetryRateLimitStateForTests(): void {
  sessionBudget.clear();
  ipBudget.clear();
}

/** Test-only introspection: how many distinct keys each budget is currently
 *  tracking — what "a store is bounded, not just window-filtered on read"
 *  actually has to assert on. */
export function getTelemetryRateLimitStoreSizeForTests(): { session: number; ip: number } {
  return { session: sessionBudget.size(), ip: ipBudget.size() };
}

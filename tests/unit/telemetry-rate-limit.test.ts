import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  allowTelemetryEvents,
  allowTelemetryEventsByIp,
  clearTelemetryRateLimitStateForTests,
  getTelemetryRateLimitKeyOrderForTests,
  getTelemetryRateLimitStoreSizeForTests,
  partitionByRateLimit,
  TELEMETRY_IP_RATE_LIMIT_MAX_EVENTS,
  TELEMETRY_RATE_LIMIT_MAX_EVENTS,
} from "../../src/lib/telemetry/rate-limit";
import { SWEEP_THRESHOLD } from "../../src/lib/shield/rate-limit";
import type { TelemetryRow } from "../../src/lib/telemetry/types";

beforeEach(() => clearTelemetryRateLimitStateForTests());

const NOW = Date.parse("2026-09-03T12:00:00Z");
const IP = "203.0.113.10";

function row(overrides: Partial<TelemetryRow> = {}): TelemetryRow {
  return {
    event_id: `id-${Math.random()}`,
    occurred_at: new Date(NOW).toISOString(),
    session_id: "session-a",
    visitor_id: null,
    user_id: null,
    event_name: "job_viewed",
    source: null,
    query_id: null,
    job_id: null,
    company_domain: null,
    position: null,
    props: {},
    ...overrides,
  };
}

test("admits up to the per-session cap, then refuses the rest", () => {
  const first = allowTelemetryEvents("s1", TELEMETRY_RATE_LIMIT_MAX_EVENTS, NOW);
  assert.equal(first, TELEMETRY_RATE_LIMIT_MAX_EVENTS, "the whole first batch fits exactly at the cap");

  const second = allowTelemetryEvents("s1", 5, NOW);
  assert.equal(second, 0, "budget is exhausted, nothing more admitted this window");
});

test("one session's budget never affects another session's — the class case, not just s1", () => {
  allowTelemetryEvents("s1", TELEMETRY_RATE_LIMIT_MAX_EVENTS, NOW);
  const other = allowTelemetryEvents("s2", 10, NOW);
  assert.equal(other, 10, "a different session has its own untouched budget");
});

test("partitionByRateLimit keeps the first N rows per session and rejects the rest with the right reason", () => {
  const rows = [
    ...Array.from({ length: TELEMETRY_RATE_LIMIT_MAX_EVENTS - 1 }, (_, i) => row({ event_id: `s1-${i}`, session_id: "s1" })),
    row({ event_id: "s1-over-1", session_id: "s1" }),
    row({ event_id: "s1-over-2", session_id: "s1" }),
    row({ event_id: "s2-ok", session_id: "s2" }),
  ];

  const { admitted, rejected } = partitionByRateLimit(rows, NOW, IP);

  assert.equal(admitted.length, TELEMETRY_RATE_LIMIT_MAX_EVENTS + 1, "999 under-cap s1 rows + 1 more to hit the cap, plus s2's independent row");
  assert.ok(admitted.some((r) => r.event_id === "s2-ok"), "the other session's row is untouched by s1 going over budget");
  assert.deepEqual(rejected, [{ event_id: "s1-over-2", reason: "rate_limited" }]);
});

test("allowTelemetryEventsByIp: admits up to its own cap, independent of any session's budget", () => {
  const first = allowTelemetryEventsByIp(IP, TELEMETRY_IP_RATE_LIMIT_MAX_EVENTS, NOW);
  assert.equal(first, TELEMETRY_IP_RATE_LIMIT_MAX_EVENTS, "the whole first batch fits exactly at the IP cap");

  const second = allowTelemetryEventsByIp(IP, 5, NOW);
  assert.equal(second, 0, "IP budget is exhausted, nothing more admitted this window");
});

test("two different session_ids from the SAME ip share one IP budget — rotating session_id does not bypass it", () => {
  // Two distinct sessions, each individually well under the per-session cap
  // (200/min), but together they exceed the IP cap (2,000/min) when enough
  // of them arrive from the same address. This is exactly the bypass guard
  // 7 needs: an attacker rotates session_id per request precisely because
  // the per-session budget alone can't see past it.
  const perSession = TELEMETRY_IP_RATE_LIMIT_MAX_EVENTS; // > per-session cap, so split across many sessions below
  const rows: TelemetryRow[] = [];
  let n = 0;
  while (rows.length < perSession + 50) {
    const sessionId = `session-${n}`;
    for (let i = 0; i < TELEMETRY_RATE_LIMIT_MAX_EVENTS && rows.length < perSession + 50; i++) {
      rows.push(row({ event_id: `evt-${rows.length}`, session_id: sessionId }));
    }
    n++;
  }

  const { admitted, rejected } = partitionByRateLimit(rows, NOW, IP);

  assert.equal(admitted.length, TELEMETRY_IP_RATE_LIMIT_MAX_EVENTS, "the shared IP budget caps total admissions across every session_id");
  assert.equal(rejected.length, rows.length - TELEMETRY_IP_RATE_LIMIT_MAX_EVENTS);
  assert.ok(rejected.every((r) => r.reason === "rate_limited"));

  // A different IP is completely unaffected — this is a per-IP budget, not
  // a global one.
  const otherIpRow = row({ event_id: "other-ip", session_id: "session-elsewhere" });
  const otherIpResult = partitionByRateLimit([otherIpRow], NOW, "198.51.100.7");
  assert.deepEqual(otherIpResult.admitted.map((r) => r.event_id), ["other-ip"]);
});

test("a key whose window has fully expired is evicted from the store once a sweep runs, keeping it bounded", () => {
  allowTelemetryEvents("will-expire", 1, NOW);
  assert.equal(getTelemetryRateLimitStoreSizeForTests().session, 1);

  const later = NOW + 60_000 + 1; // past TELEMETRY_RATE_LIMIT_WINDOW_MS, "will-expire"'s only timestamp is now stale

  // Cross SWEEP_THRESHOLD with fresh keys so the next `allow()` call triggers
  // the opportunistic sweep, which prunes any entry whose whole window has
  // aged out -- "will-expire" among them, since none of these fresh ones have.
  for (let i = 0; i < SWEEP_THRESHOLD + 1; i++) {
    allowTelemetryEvents(`fresh-${i}`, 1, later);
  }

  // Without eviction this would be SWEEP_THRESHOLD + 2 (the stale key plus
  // every fresh one); the stale key having been swept away leaves exactly
  // the fresh ones.
  assert.equal(
    getTelemetryRateLimitStoreSizeForTests().session,
    SWEEP_THRESHOLD + 1,
    "the expired key no longer occupies a slot in the store",
  );
});

// --- LRU vs FIFO eviction order --------------------------------------------
//
// `evictOldest` (rate-limit.ts) always deletes whatever key sits at the
// FRONT of the store's Map. That's only a sensible "least relevant" choice
// if writing to an EXISTING key moves it to the back — i.e. real LRU. A bare
// `Map.set(existingKey, ...)` does NOT reorder the key (proven directly
// below, same as `node -e` would show), so without re-inserting on every
// write, the front of the Map is oldest-INSERTED-first, which evicts
// whichever key has been busiest the longest — the opposite of what a rate
// limiter wants under sustained load.

test("Map.set on an EXISTING key does not reorder it (the mechanism the bug depended on)", () => {
  const m = new Map<string, number>();
  m.set("a", 1);
  m.set("b", 2);
  m.set("c", 3);
  m.set("a", 99); // update, not insert
  assert.deepEqual(
    [...m.keys()],
    ["a", "b", "c"],
    "plain Map.set on an existing key must not move it — this is the exact mechanism evictOldest relies on being handled explicitly",
  );
});

test("allow(): touching an existing key moves it to the back of eviction order (real LRU, not FIFO)", () => {
  allowTelemetryEvents("key-a", 1, NOW);
  allowTelemetryEvents("key-b", 1, NOW);
  allowTelemetryEvents("key-c", 1, NOW);
  assert.deepEqual(
    getTelemetryRateLimitKeyOrderForTests().session,
    ["key-a", "key-b", "key-c"],
    "sanity: insertion order before any re-touch",
  );

  // Re-touch the FIRST-inserted key — under FIFO this is a no-op on order
  // (key-a stays at the front, next in line for eviction, even though it
  // was just written to). Under real LRU it must move to the back.
  allowTelemetryEvents("key-a", 1, NOW);

  assert.deepEqual(
    getTelemetryRateLimitKeyOrderForTests().session,
    ["key-b", "key-c", "key-a"],
    "a key that was just written to must move to the back of eviction order — " +
      "under the old FIFO behavior this array would still read [key-a, key-b, key-c], " +
      "meaning key-a (the busiest, most-recently-active key) would be evicted NEXT, not last",
  );
});

test("allow(): the IP store's eviction order is independently real LRU too", () => {
  allowTelemetryEventsByIp("1.1.1.1", 1, NOW);
  allowTelemetryEventsByIp("2.2.2.2", 1, NOW);
  allowTelemetryEventsByIp("1.1.1.1", 1, NOW); // re-touch the first IP

  assert.deepEqual(
    getTelemetryRateLimitKeyOrderForTests().ip,
    ["2.2.2.2", "1.1.1.1"],
    "the re-touched IP must move to the back, same as the session store",
  );
});

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  allowTelemetryEvents,
  clearTelemetryRateLimitStateForTests,
  partitionByRateLimit,
  TELEMETRY_RATE_LIMIT_MAX_EVENTS,
} from "../../src/lib/telemetry/rate-limit";
import type { TelemetryRow } from "../../src/lib/telemetry/types";

beforeEach(() => clearTelemetryRateLimitStateForTests());

const NOW = Date.parse("2026-09-03T12:00:00Z");

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

  const { admitted, rejected } = partitionByRateLimit(rows, NOW);

  assert.equal(admitted.length, TELEMETRY_RATE_LIMIT_MAX_EVENTS + 1, "999 under-cap s1 rows + 1 more to hit the cap, plus s2's independent row");
  assert.ok(admitted.some((r) => r.event_id === "s2-ok"), "the other session's row is untouched by s1 going over budget");
  assert.deepEqual(rejected, [{ event_id: "s1-over-2", reason: "rate_limited" }]);
});

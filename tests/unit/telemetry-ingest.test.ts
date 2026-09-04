import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLOCK_SKEW_WINDOW_MS,
  EVENT_NAME_PATTERN,
  isBatchTooLarge,
  isBotUserAgent,
  MAX_BATCH_SIZE,
  MAX_PROPS_LENGTH,
  processBatch,
  sortByEventId,
} from "../../src/lib/telemetry/ingest";

const NOW = Date.parse("2026-09-03T12:00:00Z");

let seq = 0;
/** Deterministic, distinct-looking uuids so assertions can tell rows apart
 *  without hardcoding 36-char strings everywhere. */
function uuid(tag = ""): string {
  seq += 1;
  const n = String(seq).padStart(4, "0");
  return `${n}${tag ? tag.slice(0, 4).padEnd(4, "0") : "0000"}-0000-4000-8000-000000000000`;
}

function validEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_id: uuid(),
    occurred_at: new Date(NOW).toISOString(),
    session_id: uuid(),
    event_name: "job_viewed",
    ...overrides,
  };
}

test("accepts a well-formed event and fills unset optional columns with null", () => {
  const eventId = uuid();
  const { rows, rejections } = processBatch(
    [validEvent({ event_id: eventId })],
    NOW,
  );
  assert.equal(rejections.length, 0);
  assert.equal(rows.length, 1);
  assert.deepEqual(
    { visitor_id: rows[0].visitor_id, user_id: rows[0].user_id, query_id: rows[0].query_id, job_id: rows[0].job_id, company_domain: rows[0].company_domain, position: rows[0].position, props: rows[0].props },
    { visitor_id: null, user_id: null, query_id: null, job_id: null, company_domain: null, position: null, props: {} },
  );
});

test("a stray user_id on the wire is ignored — every row is attributed to the resolved caller identity", () => {
  const eventId = uuid();
  // A hostile or buggy client sends `user_id` anyway, naming SOMEONE ELSE's
  // uid. It must never reach the row: `RawTelemetryEvent` has no such field,
  // and parseEvent never reads it off `raw`.
  const events = [validEvent({ event_id: eventId, user_id: "someone-elses-uid" })];

  const signedIn = processBatch(events, NOW, "the-real-caller-uid");
  assert.equal(signedIn.rows[0].user_id, "the-real-caller-uid", "the row is attributed to the resolved session, not the wire value");

  const signedOut = processBatch(events, NOW, null);
  assert.equal(signedOut.rows[0].user_id, null, "signed out attributes to null, still never the wire value");
});

test("isBatchTooLarge: the class boundary, not just the one motivating size", () => {
  assert.equal(isBatchTooLarge(new Array(MAX_BATCH_SIZE).fill({})), false, "exactly at the cap is fine");
  assert.equal(isBatchTooLarge(new Array(MAX_BATCH_SIZE + 1).fill({})), true, "one over is rejected");
  assert.equal(isBatchTooLarge(new Array(200).fill({})), true, "far over is rejected");
});

test("oversized props drops only that event, not its batch neighbour", () => {
  const survivorId = uuid();
  const oversizedId = uuid();
  const events = [
    validEvent({ event_id: survivorId, props: { ok: true } }),
    validEvent({ event_id: oversizedId, props: { blob: "x".repeat(MAX_PROPS_LENGTH) } }),
  ];
  const { rows, rejections } = processBatch(events, NOW);

  assert.deepEqual(rows.map((r) => r.event_id), [survivorId]);
  assert.deepEqual(rejections, [{ event_id: oversizedId, reason: "props_too_large" }]);
});

test("a batch over the cap is a class of events processBatch never sees — the route 400s first", () => {
  // processBatch itself has no opinion on this; isBatchTooLarge is the gate.
  // Documented here so the two functions' contracts stay visibly paired.
  const big = new Array(MAX_BATCH_SIZE + 1).fill(validEvent());
  assert.equal(isBatchTooLarge(big), true);
});

test("an unknown-but-well-formed event_name is accepted — new signals need no migration", () => {
  const knownId = uuid();
  const unknownId = uuid();
  const events = [
    validEvent({ event_id: knownId, event_name: "result_clicked" }),
    validEvent({ event_id: unknownId, event_name: "brand_new_signal_2026" }),
  ];
  const { rows, rejections } = processBatch(events, NOW);

  assert.equal(rejections.length, 0);
  assert.deepEqual(new Set(rows.map((r) => r.event_id)), new Set([knownId, unknownId]));
});

test("a malformed event_name is rejected, its well-formed neighbour survives", () => {
  const badId = uuid();
  const goodId = uuid();
  const events = [
    validEvent({ event_id: badId, event_name: "Bad-Name!" }),
    validEvent({ event_id: goodId, event_name: "ok_name" }),
  ];
  const { rows, rejections } = processBatch(events, NOW);

  assert.deepEqual(rows.map((r) => r.event_id), [goodId]);
  assert.deepEqual(rejections, [{ event_id: badId, reason: "invalid_event_name" }]);
});

test("EVENT_NAME_PATTERN: shape only, never a name enumeration", () => {
  for (const ok of ["abc", "job_viewed", "a".repeat(64), "z9_9z"]) {
    assert.equal(EVENT_NAME_PATTERN.test(ok), true, ok);
  }
  for (const bad of ["ab", "Abc", "1abc", "has space", "has-dash", "a".repeat(65), ""]) {
    assert.equal(EVENT_NAME_PATTERN.test(bad), false, bad);
  }
});

test("occurred_at far in the future is clamped to now and flagged, a normal timestamp is untouched", () => {
  const futureId = uuid();
  const normalId = uuid();
  const future = new Date(NOW + 48 * 60 * 60 * 1000).toISOString(); // 48h ahead > 24h window
  const normal = new Date(NOW - 60_000).toISOString(); // 1 minute ago, well inside the window

  const { rows } = processBatch(
    [validEvent({ event_id: futureId, occurred_at: future }), validEvent({ event_id: normalId, occurred_at: normal })],
    NOW,
  );

  const futureRow = rows.find((r) => r.event_id === futureId)!;
  const normalRow = rows.find((r) => r.event_id === normalId)!;

  assert.equal(futureRow.occurred_at, new Date(NOW).toISOString(), "clamped to received/server now");
  assert.equal(futureRow.props.clock_skew, true);

  assert.equal(normalRow.occurred_at, normal, "a trustworthy timestamp is left alone");
  assert.equal("clock_skew" in normalRow.props, false);
});

test("occurred_at exactly at the clock-skew boundary is not flagged, just past it is", () => {
  const insideId = uuid();
  const outsideId = uuid();
  const inside = new Date(NOW - CLOCK_SKEW_WINDOW_MS).toISOString();
  const outside = new Date(NOW - CLOCK_SKEW_WINDOW_MS - 1).toISOString();

  const { rows } = processBatch(
    [validEvent({ event_id: insideId, occurred_at: inside }), validEvent({ event_id: outsideId, occurred_at: outside })],
    NOW,
  );

  assert.equal("clock_skew" in rows.find((r) => r.event_id === insideId)!.props, false);
  assert.equal(rows.find((r) => r.event_id === outsideId)!.props.clock_skew, true);
});

test("duplicate event_ids within one batch collapse — first kept, repeat rejected", () => {
  const dupeId = uuid();
  const otherId = uuid();
  const events = [
    validEvent({ event_id: dupeId, props: { first: true } }),
    validEvent({ event_id: otherId }),
    validEvent({ event_id: dupeId, props: { first: false } }),
  ];
  const { rows, rejections } = processBatch(events, NOW);

  assert.deepEqual(new Set(rows.map((r) => r.event_id)), new Set([dupeId, otherId]));
  assert.equal(rows.find((r) => r.event_id === dupeId)!.props.first, true, "the first occurrence wins");
  assert.deepEqual(rejections, [{ event_id: dupeId, reason: "duplicate_event_id" }]);
});

test("invalid shape (bad uuid, missing field, wrong type) is rejected; a well-formed neighbour survives", () => {
  const goodId = uuid();
  const cases: Array<[string, Record<string, unknown>]> = [
    ["missing event_id", validEvent({ event_id: undefined })],
    ["non-uuid event_id", validEvent({ event_id: "not-a-uuid" })],
    ["non-uuid session_id", validEvent({ session_id: "not-a-uuid" })],
    ["non-uuid visitor_id", validEvent({ visitor_id: "not-a-uuid" })],
    ["non-string event_name", validEvent({ event_name: 123 })],
    ["unparseable occurred_at", validEvent({ occurred_at: "not-a-date" })],
    ["non-integer position", validEvent({ position: 1.5 })],
    ["array as props", validEvent({ props: ["nope"] })],
    ["null", null as unknown as Record<string, unknown>],
    ["array", [] as unknown as Record<string, unknown>],
  ];

  const { rows, rejections } = processBatch([...cases.map(([, e]) => e), validEvent({ event_id: goodId })], NOW);

  assert.equal(rows.length, 1, "only the well-formed event survives");
  assert.equal(rows[0].event_id, goodId);
  assert.equal(rejections.length, cases.length);
  for (const r of rejections) assert.equal(r.reason, "invalid_shape");
});

test("guard order: bad event_name + oversized props -> props_too_large (guard 3 runs before guard 4)", () => {
  const eventId = uuid();
  const { rejections } = processBatch(
    [validEvent({ event_id: eventId, event_name: "Bad-Name!", props: { blob: "x".repeat(MAX_PROPS_LENGTH) } })],
    NOW,
  );
  assert.deepEqual(rejections, [{ event_id: eventId, reason: "props_too_large" }]);
});

test("guard order: valid event_name + oversized props -> props_too_large (no regression)", () => {
  const eventId = uuid();
  const { rejections } = processBatch(
    [validEvent({ event_id: eventId, event_name: "ok_name", props: { blob: "x".repeat(MAX_PROPS_LENGTH) } })],
    NOW,
  );
  assert.deepEqual(rejections, [{ event_id: eventId, reason: "props_too_large" }]);
});

test("guard order: bad event_name + small props -> invalid_event_name (no regression)", () => {
  const eventId = uuid();
  const { rejections } = processBatch(
    [validEvent({ event_id: eventId, event_name: "Bad-Name!", props: { ok: true } })],
    NOW,
  );
  assert.deepEqual(rejections, [{ event_id: eventId, reason: "invalid_event_name" }]);
});

test("guard order: invalid shape + oversized props -> invalid_shape (shape is checked first, wins over both)", () => {
  const eventId = uuid();
  const { rejections } = processBatch(
    [validEvent({ event_id: eventId, session_id: "not-a-uuid", props: { blob: "x".repeat(MAX_PROPS_LENGTH) } })],
    NOW,
  );
  assert.deepEqual(rejections, [{ event_id: eventId, reason: "invalid_shape" }]);
});

test("sortByEventId orders ascending regardless of input order", () => {
  const rows = [{ event_id: "c" }, { event_id: "a" }, { event_id: "b" }];
  assert.deepEqual(sortByEventId(rows).map((r) => r.event_id), ["a", "b", "c"]);
});

test("processBatch returns rows sorted by event_id, independent of arrival order", () => {
  const ids = [uuid(), uuid(), uuid()].sort().reverse(); // arrival = descending
  const { rows } = processBatch(ids.map((id) => validEvent({ event_id: id })), NOW);
  assert.deepEqual(rows.map((r) => r.event_id), [...ids].sort());
});

test("isBotUserAgent: named crawlers and generic tokens match, real browsers and null do not", () => {
  for (const ua of ["Googlebot/2.1 (+http://www.google.com/bot.html)", "GPTBot", "SemrushBot-SA", "curl-scraperBot/1.0"]) {
    assert.equal(isBotUserAgent(ua), true, ua);
  }
  for (const ua of [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
  ]) {
    assert.equal(isBotUserAgent(ua), false, ua);
  }
  assert.equal(isBotUserAgent(null), true, "no UA at all reads as a bot");
  assert.equal(isBotUserAgent(""), true);
  assert.equal(isBotUserAgent("   "), true);
});

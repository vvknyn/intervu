/**
 * `buildMissingRowDiagnosis` (scripts/verify-telemetry-e2e.ts) is the honest
 * replacement for a diagnosis function that named only 2 causes for a
 * missing row when there are 7+ (5 `TelemetryRejectionReason`s, bot-UA
 * classification, and a caught insert exception — on top of schema drift and
 * pipeline-wide failure). The concrete false-positive that motivated this
 * fix: IP rate-limiting (or any other per-event drop) leaves the schema
 * completely intact, so the old two-branch version would confidently — and
 * wrongly — blame a missing `TELEMETRY_PG_URL`. These tests assert the new
 * function only ever names a cause it actually established (schema drift,
 * via a real `information_schema` query result) and otherwise enumerates
 * every undistinguished possibility instead of guessing one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMissingRowDiagnosis } from "../../scripts/verify-telemetry-e2e";
import { TELEMETRY_REJECTION_REASONS } from "../../src/lib/telemetry/types";

test("schema drift: the one cause this script can prove is asserted, alone — no other cause guessed alongside a confirmed finding", () => {
  const message = buildMissingRowDiagnosis(["event_id", "props"], 5);
  assert.match(message, /schema drift established/);
  assert.match(message, /event_id, props/);
  assert.doesNotMatch(message, /rate_limited/);
  assert.doesNotMatch(message, /TELEMETRY_PG_URL/);
});

test("class proof: schema drift fires for a DIFFERENT missing column than the old hand-copied 6-column list ever checked", () => {
  // The old `expectedColumns` array checked only 6 of the route's 12 insert
  // columns; visitor_id, source, occurred_at, props, session_id and user_id
  // were never checked, so drift in any of them silently fell through to the
  // wrong "TELEMETRY_PG_URL unset" branch. visitor_id here proves the fix is
  // column-agnostic (derived from route.ts's own TELEMETRY_COLUMNS), not a
  // second hand-picked shortlist.
  const message = buildMissingRowDiagnosis(["visitor_id"], 0);
  assert.match(message, /schema drift established/);
  assert.match(message, /visitor_id/);
});

test("schema intact + other rows landing recently: every per-event cause is listed, none is singled out as THE cause", () => {
  const message = buildMissingRowDiagnosis([], 3);

  for (const reason of TELEMETRY_REJECTION_REASONS) {
    assert.ok(message.includes(reason), `must list "${reason}" as an undistinguished possibility`);
  }
  assert.match(message, /bot user-agent/);
  assert.match(message, /insert itself threw/);

  // The reviewer's concrete scenario: rate limiting (or any other per-event
  // drop) must never get relabeled as a pipeline-wide TELEMETRY_PG_URL
  // outage once other rows prove the write path works.
  assert.doesNotMatch(message, /TELEMETRY_PG_URL/);
});

test("schema intact + nothing landed recently: widens to pipeline-wide causes IN ADDITION to, not instead of, the per-event ones", () => {
  const message = buildMissingRowDiagnosis([], 0);

  assert.match(message, /TELEMETRY_PG_URL/);
  assert.match(message, /can't reach Postgres/);
  for (const reason of TELEMETRY_REJECTION_REASONS) {
    assert.ok(message.includes(reason), `per-event causes stay listed even in the pipeline-wide branch`);
  }
});

test("never collapses to a single bare cause when nothing is established — the message frames it as an enumerated list", () => {
  const message = buildMissingRowDiagnosis([], 1);
  assert.match(message, /no single cause is/);
  assert.match(message, /Undistinguished possibilities/);
});

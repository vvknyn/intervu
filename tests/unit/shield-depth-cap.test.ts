import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ANONYMOUS_DEPTH_GATE_MESSAGE,
  ANON_MAX_OFFSET,
  ANON_PAGE_SIZE,
  resolveDepthCap,
} from "../../src/lib/shield/depth-cap";

test("resolveDepthCap: signed-in users pass through completely unchanged", () => {
  const decision = resolveDepthCap({ offset: ANON_MAX_OFFSET * 10, limit: 500, isAuthed: true });
  assert.equal(decision.gated, false);
  assert.equal(decision.effectiveLimit, 500);
});

test("resolveDepthCap: signed-in users with an omitted limit pass through as undefined", () => {
  const decision = resolveDepthCap({ offset: undefined, limit: undefined, isAuthed: true });
  assert.equal(decision.gated, false);
  assert.equal(decision.effectiveLimit, undefined);
});

test("resolveDepthCap: anonymous first pages are allowed", () => {
  const decision = resolveDepthCap({ offset: 0, limit: ANON_PAGE_SIZE, isAuthed: false });
  assert.equal(decision.gated, false);
  assert.equal(decision.effectiveLimit, ANON_PAGE_SIZE);
});

test("resolveDepthCap: anonymous deep offsets are gated", () => {
  const decision = resolveDepthCap({ offset: ANON_MAX_OFFSET, limit: ANON_PAGE_SIZE, isAuthed: false });
  assert.equal(decision.gated, true);
  assert.equal(decision.effectiveLimit, 0);
});

test("ANONYMOUS_DEPTH_GATE_MESSAGE prompts account creation", () => {
  assert.match(ANONYMOUS_DEPTH_GATE_MESSAGE, /account/i);
});

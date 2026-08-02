import { test } from "node:test";
import assert from "node:assert/strict";
import { ANON_MAX_OFFSET, ANON_PAGE_SIZE, resolveDepthCap } from "../../src/lib/shield/depth-cap";

test("resolveDepthCap: signed-in users pass through completely unchanged, including a huge offset", () => {
  const decision = resolveDepthCap({ offset: ANON_MAX_OFFSET * 10, limit: 500, isAuthed: true });
  assert.equal(decision.gated, false);
  assert.equal(decision.effectiveLimit, 500);
});

test("resolveDepthCap: signed-in users with an omitted limit pass through as undefined (backend's own default)", () => {
  const decision = resolveDepthCap({ offset: undefined, limit: undefined, isAuthed: true });
  assert.equal(decision.gated, false);
  assert.equal(decision.effectiveLimit, undefined);
});

test("resolveDepthCap: anonymous first page (offset 0) is never gated", () => {
  const decision = resolveDepthCap({ offset: 0, limit: ANON_PAGE_SIZE, isAuthed: false });
  assert.equal(decision.gated, false);
  assert.equal(decision.effectiveLimit, ANON_PAGE_SIZE);
});

test("resolveDepthCap: anonymous requests stay ungated through the last allowed page", () => {
  // 3 pages of 30 = offsets 0, 30, 60 all allowed.
  for (const offset of [0, ANON_PAGE_SIZE, ANON_MAX_OFFSET - ANON_PAGE_SIZE]) {
    const decision = resolveDepthCap({ offset, limit: ANON_PAGE_SIZE, isAuthed: false });
    assert.equal(decision.gated, false, `offset ${offset} should not be gated`);
  }
});

test("resolveDepthCap: anonymous request landing exactly on the boundary offset is gated", () => {
  const decision = resolveDepthCap({ offset: ANON_MAX_OFFSET, limit: ANON_PAGE_SIZE, isAuthed: false });
  assert.equal(decision.gated, true);
  assert.equal(decision.effectiveLimit, 0);
});

test("resolveDepthCap: anonymous request deep past the boundary is gated", () => {
  const decision = resolveDepthCap({ offset: ANON_MAX_OFFSET * 5, limit: ANON_PAGE_SIZE, isAuthed: false });
  assert.equal(decision.gated, true);
});

test("resolveDepthCap: a single oversized limit can't be used to skip the window in one request", () => {
  // offset 0 with a limit of 10,000 must not hand back 10,000 rows — it's
  // clamped to what's left in the anonymous window (the full 90).
  const decision = resolveDepthCap({ offset: 0, limit: 10_000, isAuthed: false });
  assert.equal(decision.gated, false);
  assert.equal(decision.effectiveLimit, ANON_MAX_OFFSET);
});

test("resolveDepthCap: partial window remaining on the last page is clamped to what's left, not the full page size", () => {
  const offset = ANON_MAX_OFFSET - 5;
  const decision = resolveDepthCap({ offset, limit: ANON_PAGE_SIZE, isAuthed: false });
  assert.equal(decision.gated, false);
  assert.equal(decision.effectiveLimit, 5);
});

test("resolveDepthCap: anonymous request with an omitted limit falls back to the page-size default", () => {
  const decision = resolveDepthCap({ offset: 0, limit: undefined, isAuthed: false });
  assert.equal(decision.gated, false);
  assert.equal(decision.effectiveLimit, ANON_PAGE_SIZE);
});

test("resolveDepthCap: negative/omitted offset treated as the first page, not gated", () => {
  const decision = resolveDepthCap({ offset: -5, limit: ANON_PAGE_SIZE, isAuthed: false });
  assert.equal(decision.gated, false);
});

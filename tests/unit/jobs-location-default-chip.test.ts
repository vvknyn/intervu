import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldShowLocationDefaultChip } from "../../src/lib/jobs/location-default-preference";

// Grok UX wave G3 — the location control's own disclosure chip (moved
// in from the results row) shows only while a default is actually active
// AND the searcher hasn't typed a location of their own.

test("shouldShowLocationDefaultChip: shows when a default is applied and the location box is empty", () => {
  assert.equal(shouldShowLocationDefaultChip("CA", ""), true);
});

test("shouldShowLocationDefaultChip: hides once the searcher has typed their own location", () => {
  assert.equal(shouldShowLocationDefaultChip("CA", "Toronto"), false);
});

test("shouldShowLocationDefaultChip: hides when whitespace-only draft (still effectively empty) — chip still shows", () => {
  // Whitespace-only input hasn't committed a real location yet, so the
  // disclosure stays visible rather than disappearing on a stray space.
  assert.equal(shouldShowLocationDefaultChip("CA", "   "), true);
});

test("shouldShowLocationDefaultChip: hides when no default was applied at all, regardless of the draft", () => {
  assert.equal(shouldShowLocationDefaultChip(undefined, ""), false);
  assert.equal(shouldShowLocationDefaultChip(null, ""), false);
  assert.equal(shouldShowLocationDefaultChip(undefined, "Toronto"), false);
});

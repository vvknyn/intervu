import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldShowLocationDefaultChip } from "../../src/lib/jobs/location-default-preference";

// Grok UX wave G3 — the location control's own disclosure chip (moved
// in from the results row) shows only while a default is actually active
// AND the searcher hasn't chosen a location of their own.
//
// The second argument is the CHOSEN places, not the box's draft text: since
// the box became a multi-place entry field, an empty box no longer means "no
// location" (it usually means "just committed one").

test("shouldShowLocationDefaultChip: shows when a default is applied and no place is chosen", () => {
  assert.equal(shouldShowLocationDefaultChip("CA", []), true);
});

test("shouldShowLocationDefaultChip: hides once the searcher has chosen their own location", () => {
  assert.equal(shouldShowLocationDefaultChip("CA", ["Toronto"]), false);
});

test("shouldShowLocationDefaultChip: hides for every chosen place, not just the first", () => {
  // The case a `[0]`-only check would miss: the chip must not reappear
  // because some later entry is the interesting one.
  assert.equal(shouldShowLocationDefaultChip("CA", ["Toronto", "Montréal"]), false);
  assert.equal(shouldShowLocationDefaultChip("CA", ["", "Montréal"]), false);
});

test("shouldShowLocationDefaultChip: a whitespace-only entry is still no location — chip stays", () => {
  // Whitespace hasn't committed a real place, so the disclosure stays
  // visible rather than disappearing on a stray space.
  assert.equal(shouldShowLocationDefaultChip("CA", ["   "]), true);
  assert.equal(shouldShowLocationDefaultChip("CA", ["  ", ""]), true);
});

test("shouldShowLocationDefaultChip: hides when no default was applied at all, regardless of choices", () => {
  assert.equal(shouldShowLocationDefaultChip(undefined, []), false);
  assert.equal(shouldShowLocationDefaultChip(null, []), false);
  assert.equal(shouldShowLocationDefaultChip(undefined, ["Toronto"]), false);
});

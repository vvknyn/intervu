import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldShowLocationDefaultChip, buildDockedChips, DEFAULT_LOCATION_CHIP_KEY } from "../../src/lib/jobs/location-default-preference";

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

// buildDockedChips — the desktop header-dock's chip list (TopBar.tsx
// `docked.chips`), with the applied-location-default chip PREPENDED when
// `shouldShowLocationDefaultChip` says one should show. This is the fix for
// the prod bug where the chip's only mount was dead behind
// `headerDockActive` on >=lg viewports: the dock effect now builds its chip
// array through this ONE helper instead of only ever mapping filter entries.

test("buildDockedChips: prepends the default-location chip when an iso2 is given", () => {
  // "US" resolves a flag via countryToFlag's "us" alias for United States —
  // a realistic geo-lookup return, unlike most bare ISO2 codes (see the
  // country-flag.ts passthrough-removal note).
  const chips = buildDockedChips("US", [{ key: "work_type", label: "Remote" }]);
  assert.equal(chips.length, 2);
  assert.equal(chips[0].key, DEFAULT_LOCATION_CHIP_KEY);
  assert.match(chips[0].label, /near /);
  assert.ok(chips[0].label.startsWith("🇺🇸"), `expected a leading US flag, got ${JSON.stringify(chips[0].label)}`);
  assert.deepEqual(chips[1], { key: "work_type", label: "Remote" });
});

test("buildDockedChips: null iso2 returns entryChips unchanged (same reference)", () => {
  const entryChips = [{ key: "work_type", label: "Remote" }];
  assert.equal(buildDockedChips(null, entryChips), entryChips);
});

test("buildDockedChips: an iso2 countryToFlag can't map still yields a clean \"near ...\" label, no leading whitespace", () => {
  // "CA" is the exact prod case (fiber probe showed defaultedLocation="CA")
  // and is explicitly excluded by countryToFlag's US-state-collision guard
  // (California vs Canada) — it never resolves a flag, so the label must not
  // carry the incidental leading space the mobile chip's JSX would.
  const chips = buildDockedChips("CA", []);
  assert.equal(chips.length, 1);
  assert.equal(chips[0].key, DEFAULT_LOCATION_CHIP_KEY);
  assert.match(chips[0].label, /^near /);
});

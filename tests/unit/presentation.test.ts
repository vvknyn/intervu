import assert from "node:assert/strict";
import { test } from "node:test";
import { GHOST_META, isInternalPosting, titleCaseDisplay } from "../../src/lib/jobs/presentation";
import { ghostBadgeTone, STATUS_PILL } from "../../src/lib/ui/status-tokens";

test("title-cases an all-uppercase string", () => {
  assert.equal(titleCaseDisplay("WARSZAWA, POLAND"), "Warszawa, Poland");
});

test("title-cases an all-lowercase string", () => {
  assert.equal(titleCaseDisplay("orange"), "Orange");
});

// The class of bug this guards, not just the instance: any deliberately
// mixed-case name must survive untouched, not just the one example seen live.
test("leaves deliberately mixed-case names untouched", () => {
  assert.equal(titleCaseDisplay("eBay"), "eBay");
  assert.equal(titleCaseDisplay("McDonald's"), "McDonald's");
});

test("leaves already-normal title case untouched", () => {
  assert.equal(titleCaseDisplay("Warszawa, Poland"), "Warszawa, Poland");
});

// GHOST_META used to hand-pick a STATUS_PILL entry per badge, and that copy
// drifted: `ghostBadgeTone` was introduced specifically to stop `caution` and
// `likely_ghost` sharing one amber tone ("collapsing 'review' and 'possible
// ghost' into the same color hid the worse verdict" — its own doc), the radar
// bars and mix bands were moved onto it, and this map — the one every surface
// a reader actually meets a POSTING on reads from — was left behind on
// `STATUS_PILL.intv`. Asserted as a derivation over every badge, not as three
// expected color strings, so the next tone change can't reopen the gap.
test("GHOST_META colors are derived from ghostBadgeTone, not a second hand-picked map", () => {
  for (const badge of ["clear", "caution", "likely_ghost"] as const) {
    assert.equal(GHOST_META[badge]!.cls, STATUS_PILL[ghostBadgeTone(badge)], badge);
  }
  assert.equal(GHOST_META.unscored, null, "unscored has no tone and renders no badge");
});

test("a possible-ghost posting never looks like a merely-cautioned one", () => {
  assert.notEqual(GHOST_META.likely_ghost!.cls, GHOST_META.caution!.cls);
  assert.notEqual(GHOST_META.likely_ghost!.label, GHOST_META.caution!.label);
});

test("isInternalPosting matches a leading [Internal] tag", () => {
  assert.equal(isInternalPosting("[Internal] Developer, Rust"), true);
});

// A second phrasing, not just the one that motivated the fix — the tag isn't
// a fixed string, it's "a bracket that starts with 'internal'".
test("isInternalPosting matches a differently-worded internal tag", () => {
  assert.equal(isInternalPosting("[INTERNAL ONLY] Senior Platform Engineer"), true);
});

test("isInternalPosting never flags a normal public title", () => {
  assert.equal(isInternalPosting("Internal Audit Manager"), false);
  assert.equal(isInternalPosting("International Business Analyst"), false);
  assert.equal(isInternalPosting("Senior Software Engineer"), false);
  assert.equal(isInternalPosting(null), false);
  assert.equal(isInternalPosting(undefined), false);
});

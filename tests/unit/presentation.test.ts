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

// A2 audit defect (2026-09-09 prod screenshot): ALL-CAPS/lowercase job
// titles and company names render raw ("DENTAL ASSISTANT / STERILIZATION /
// JR ADMIN", "the home depot canada"). A digit-bearing token is left alone
// (a job code, not a word to re-case), and a short all-letter token survives
// as an acronym only when the WHOLE source was already shouting — the same
// "JR"/"CNC" would flatten to "Jr"/"Cnc" if the source were mixed-case, per
// the "leaves deliberately mixed-case names untouched" rule above.
test("re-cases a slash-separated all-caps job title, keeping short acronyms shouting", () => {
  assert.equal(
    titleCaseDisplay("DENTAL ASSISTANT / STERILIZATION / JR ADMIN"),
    "Dental Assistant / Sterilization / JR Admin",
  );
});

test("a token carrying a digit is left exactly as-is, not re-cased", () => {
  assert.equal(titleCaseDisplay("CNC MACHINIST - 310T"), "CNC Machinist - 310T");
});

test("lowercases a small connector mid-title but not the leading word", () => {
  assert.equal(titleCaseDisplay("SALES AND MARKETING MANAGER"), "Sales and Marketing Manager");
  assert.equal(titleCaseDisplay("THE HOME DEPOT CANADA"), "The Home Depot Canada");
});

test("re-cases an all-lowercase company name the same as its all-caps twin", () => {
  assert.equal(titleCaseDisplay("the home depot canada"), "The Home Depot Canada");
  assert.equal(titleCaseDisplay("kijiji canada"), "Kijiji Canada");
});

test("a mixed-case brand or role name already carrying deliberate casing is untouched", () => {
  assert.equal(titleCaseDisplay("eBay Product Manager"), "eBay Product Manager");
  assert.equal(titleCaseDisplay("Senior EMT"), "Senior EMT");
});

// Class defect found by a probe against commit 2ffe511: the connector rule
// fired on ANY occurrence of a connector word regardless of position, so a
// trailing province/state code that happens to spell a connector ("ON",
// "OR", "IN") got silently lowercased ("TORONTO, ON" -> "Toronto, on"); and
// the blanket "<=3 letters stays shouting" rule caught ordinary short words
// ("NEW", "SAN") right along with real 2-3 letter codes. Fixed by making the
// connector rule position-aware (only fires when the token actually joins
// two neighbours, nothing but whitespace on either side) and replacing the
// length cutoff with two closed dictionaries of ordinary short words.
test("a trailing province/state code that spells a connector word stays a code, not a lowercase word", () => {
  assert.equal(titleCaseDisplay("TORONTO, ON"), "Toronto, ON");
  assert.equal(titleCaseDisplay("PORTLAND, OR - REMOTE"), "Portland, OR - Remote");
  assert.equal(titleCaseDisplay("DIRECTOR OF SALES, IN"), "Director of Sales, IN");
});

test("an ordinary short word is capitalized, not kept shouting, even next to a real code", () => {
  assert.equal(titleCaseDisplay("NEW ORLEANS, LA"), "New Orleans, LA");
  assert.equal(titleCaseDisplay("SAN DIEGO, CA"), "San Diego, CA");
  assert.equal(titleCaseDisplay("NEW GRAD RN"), "New Grad RN");
});

test("a 2-letter token immediately followed by a period is capitalized as an abbreviation", () => {
  assert.equal(titleCaseDisplay("ST. LOUIS, MO"), "St. Louis, MO");
});

test("a connector mid-title is still lowercased when it genuinely joins two words", () => {
  assert.equal(titleCaseDisplay("SALES AND MARKETING MANAGER"), "Sales and Marketing Manager");
});

test("a known 4+ letter acronym stays shouting, an ordinary 4+ letter word does not", () => {
  assert.equal(titleCaseDisplay("HVAC TECHNICIAN - ICU"), "HVAC Technician - ICU");
});

test("documented limitation: an all-lowercase source can't distinguish a code from a word", () => {
  // Unlike the all-caps path (which has the two dictionaries to fall back
  // on), a lowercase source only capitalizes every non-connector token —
  // there is no signal left in "on" to say it should become "ON" not "On".
  assert.equal(titleCaseDisplay("toronto, on"), "Toronto, On");
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

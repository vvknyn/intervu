import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GHOST_META,
  HEADLINE_POLICY,
  isInternalPosting,
  resolveHeadlineTotal,
  stripStreetAddress,
  tieredSeamIndex,
  titleCaseDisplay,
  visibleTags,
} from "../../src/lib/jobs/presentation";
import type { PublicJob } from "../../src/lib/jobs/types";
import { ghostBadgeTone, STATUS_PILL } from "../../src/lib/ui/status-tokens";

function hit(id: string, tier?: 1 | 2): PublicJob {
  return { id, tier } as unknown as PublicJob;
}

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
// (a job code, not a word to re-case). "JR" is an ordinary short word (the
// TITLE_CASE_SHORT_WORDS_2 lexicon), not a code, so it re-cases like any
// other short word regardless of whether the whole source was shouting.
test("re-cases a slash-separated all-caps job title, treating JR as a word not a code", () => {
  assert.equal(
    titleCaseDisplay("DENTAL ASSISTANT / STERILIZATION / JR ADMIN"),
    "Dental Assistant / Sterilization / Jr Admin",
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

test("SR is an ordinary word, not a code, even without a trailing period; HR stays a code", () => {
  assert.equal(titleCaseDisplay("SR MANAGER, HR"), "Sr Manager, HR");
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

// D1: a 2-letter unit-word lookalike ("fl") colliding with a state/province
// code used to drop the whole part. `classifyLocationPart`'s rule 3 only
// drops a unit marker followed by ITS OWN number ("Suite 200"); "FL 33602"
// keeps the code and lets `stripEmbeddedNoise`'s US postal regex take the
// ZIP on its own.
test("a 2-letter state code is never mistaken for a unit-word marker", () => {
  assert.equal(stripStreetAddress("Miami, FL"), "Miami, FL");
  assert.equal(stripStreetAddress("Tampa, FL 33602"), "Tampa, FL");
  assert.equal(stripStreetAddress("Orlando, FL, United States"), "Orlando, FL, United States");
  // AU 4-digit postcode: the un-numbered part "Sydney NSW 2000" is kept
  // whole — stripEmbeddedNoise only strips a US 5-digit shape, so the code
  // deliberately produces "Sydney NSW 2000" rather than adding an
  // AU-specific rule.
  assert.equal(stripStreetAddress("Level 3, Sydney NSW 2000"), "Sydney NSW 2000");
});

// D2: postcode-then-city (DE/AT/FR/NL/DK …) used to read as a house number
// and drop the whole part.
test("a leading 4+ digit postcode keeps its city, unlike a short house number", () => {
  assert.equal(stripStreetAddress("10115 Berlin"), "Berlin");
  assert.equal(stripStreetAddress("1010 Wien, Austria"), "Wien, Austria");
  assert.equal(stripStreetAddress("60313 Frankfurt am Main, Germany"), "Frankfurt am Main, Germany");
  assert.equal(stripStreetAddress("1012 AB Amsterdam"), "Amsterdam");
  assert.equal(stripStreetAddress("8000 Aarhus C, Denmark"), "Aarhus C, Denmark");
});

test("a genuine house number + street is still dropped, postcode+city rule aside", () => {
  assert.equal(
    stripStreetAddress("626 Polymoore Drive, Corunna, ON N0N 1G0, Canada"),
    "Corunna, ON, Canada",
  );
  assert.equal(stripStreetAddress("100 Broadway, New York, NY 10001"), "New York, NY");
  assert.equal(stripStreetAddress("1600 Amphitheatre Parkway, Mountain View, CA"), "Mountain View, CA");
  assert.equal(stripStreetAddress("12 Rue Nationale, 75001 Paris"), "Paris");
});

// Rule 2': street-name-first addresses (IT/ES/DE/FR) put the house number
// at the END of the part instead of the start, so rule 2 (number-first)
// never sees them. `endsWithStreetWord` catches both the separate-token
// shape ("Via Roma", "Calle Mayor") and the DE compound shape, where the
// street suffix is fused directly onto the name with no separator
// ("Musterstraße"). Both a street word AND a trailing house number are
// required, proven by two keeps: a number alone ("Dublin 2", a postal
// district, not an address) and a street-word lookalike alone ("Trail, BC",
// a real place name) each survive on their own.
test("a name-first street address is still dropped, across languages", () => {
  assert.equal(stripStreetAddress("Via Roma 10, 00100 Roma"), "Roma");
  assert.equal(stripStreetAddress("Musterstraße 5, 80331 München"), "München");
  assert.equal(stripStreetAddress("Calle Mayor 3, 28013 Madrid"), "Madrid");
  assert.equal(stripStreetAddress("Dublin 2"), "Dublin 2");
  assert.equal(stripStreetAddress("Trail, BC"), "Trail, BC");
});

// D3: ordinal suffixes ("1st", "21st") are two letters, and a unit word
// used to only match at the very start of a part.
test("an ordinal house number or a unit word mid-part is still dropped", () => {
  assert.equal(stripStreetAddress("1st Avenue, Seattle, WA 98101"), "Seattle, WA");
  assert.equal(stripStreetAddress("42nd Street, New York, NY"), "New York, NY");
  assert.equal(stripStreetAddress("21st Floor, 100 Broadway, New York, NY"), "New York, NY");
  assert.equal(stripStreetAddress("Suite 200, 1 Main St, Boston, MA"), "Boston, MA");
  assert.equal(stripStreetAddress("Floor 2, Dublin"), "Dublin");
  assert.equal(stripStreetAddress("Unit 4, 20 Queen St W, Toronto, ON M5H 3R3"), "Toronto, ON");
});

// Round 2 (Sep 10 2026) defect: the seam used to be `tier1Total` (an
// absolute count over the UNFILTERED pool) indexed into a `hideViewed`-
// filtered `hits` array, so it landed on the wrong row whenever a client
// filter removed rows ahead of it. `tieredSeamIndex` fixes the class of bug
// by reading each hit's OWN `tier`, so it must still be correct once rows
// are removed — not just on the untouched list.
test("tieredSeamIndex: hideViewed removing two tier-1 rows still seams before the first tier-2 row", () => {
  // Simulates `hits` AFTER hideViewed already dropped two tier-1 rows that
  // sat ahead of the tier-2 block in the original (unfiltered) pool.
  const filtered = [hit("t1-a", 1), hit("t2-a", 2), hit("t2-b", 2)];
  assert.equal(tieredSeamIndex(filtered), 1);
});

test("tieredSeamIndex: a list whose very first hit is tier 2 seams at index 0, not -1", () => {
  const filtered = [hit("t2-a", 2), hit("t2-b", 2)];
  assert.equal(tieredSeamIndex(filtered), 0);
});

test("tieredSeamIndex: no hit carries `tier` (non-federated mechanism) returns null, not a seam", () => {
  const hits = [hit("a"), hit("b"), hit("c")];
  assert.equal(tieredSeamIndex(hits), null);
});

test("tieredSeamIndex: an all-tier-1 tiered result has no seam to draw", () => {
  const hits = [hit("a", 1), hit("b", 1)];
  assert.equal(tieredSeamIndex(hits), -1);
});

// Round 2 defect: `resolveHeadlineTotal`'s doc claimed to "select" between
// `total`/`tier1Total` but its body was a hardcoded `return input.total`.
// `HEADLINE_POLICY` is now the one real flip point.
test("resolveHeadlineTotal: HEADLINE_POLICY defaults to \"union\" (input.total), the current product default", () => {
  assert.equal(HEADLINE_POLICY, "union");
  assert.equal(resolveHeadlineTotal({ total: 2231, tier1Total: 589 }), 2231);
});

test("resolveHeadlineTotal: policy \"titled\" returns tier1Total when present", () => {
  assert.equal(resolveHeadlineTotal({ total: 2231, tier1Total: 589 }, "titled"), 589);
});

test("resolveHeadlineTotal: policy \"titled\" with tier1Total undefined falls back to total", () => {
  assert.equal(resolveHeadlineTotal({ total: 42 }, "titled"), 42);
});

// A raw array field (`job.tags`, `job.must_have_skills`) passing `.length > 0`
// does not guarantee any entry decodes to real content — an array of blank
// or garbage strings survives that check and used to render a heading
// ("Keywords from the posting") over nothing. `visibleTags` is the one
// chokepoint every such section now gates on instead.
test("visibleTags: null/undefined input is an empty list", () => {
  assert.deepEqual(visibleTags(null, 16), []);
  assert.deepEqual(visibleTags(undefined, 16), []);
});

test("visibleTags: an array of only blank/whitespace entries decodes to nothing — the actual defect (a heading with no content)", () => {
  assert.deepEqual(visibleTags(["", "   ", "%20"], 16), []);
});

test("visibleTags: a different field shape (mixed real, blank, and URL-encoded entries) keeps only real decoded content, respecting the limit", () => {
  assert.deepEqual(visibleTags(["REST", "", "Spark%20AI", "  ", "SQL"], 2), ["REST", "Spark AI"]);
});

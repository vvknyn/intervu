import { test } from "node:test";
import assert from "node:assert/strict";

import { isMalformedLocationValue } from "../../src/lib/geo/malformed-location-value";

/**
 * isMalformedLocationValue is the positive-evidence gate for the /jobs
 * location typeahead: values with a structural parser-artifact tell
 * (unbalanced bracket, raw delimiter character, collapsed whitespace) are
 * suppressed; everything else — including places nobody has catalogued —
 * still renders. See src/lib/geo/malformed-location-value.ts for why.
 */

test("flags the three malformed rows measured live under Canada", () => {
    assert.equal(isMalformedLocationValue("Canada -  (ON"), true);
    assert.equal(isMalformedLocationValue("Canada (Alberta"), true);
    assert.equal(isMalformedLocationValue("Canada | Logan"), true);
});

test("the same tells fire for a country the corpus has never put next to Canada", () => {
    // Unbalanced parenthesis and a raw pipe delimiter are structural — they
    // do not know or care which country's name they're attached to.
    assert.equal(isMalformedLocationValue("Mexico (Jalisco"), true);
    assert.equal(isMalformedLocationValue("Germany | Berlin"), true);
    assert.equal(isMalformedLocationValue("Japan -  (Osaka"), true);
});

test("does NOT suppress real places that merely collide with a heading, known or not", () => {
    // These are genuinely reported as real places sitting under a less-apt
    // heading (task corollary) — well-formed strings, not parser artifacts.
    assert.equal(isMalformedLocationValue("Canary Wharf"), false);
    assert.equal(isMalformedLocationValue("Canton"), false);
    assert.equal(isMalformedLocationValue("Candelaria"), false);
});

test("an unknown-but-well-formed place still renders — absence of gazetteer knowledge is not evidence", () => {
    // A small town, a new region, a non-English name: none of these are in
    // any list this predicate consults, and none of them get suppressed.
    assert.equal(isMalformedLocationValue("Zzyzx"), false);
    assert.equal(isMalformedLocationValue("Nizhny Novgorod"), false);
    assert.equal(isMalformedLocationValue("Świnoujście"), false);
});

test("backtick is not a delimiter tell — it is the ASCII stand-in for a real diacritic in romanized names", () => {
    // Hawaiian ʻokina and Arabic ʿayn/hamza are both commonly typed as a
    // backtick when the real combining character isn't available. Flagging
    // these would be exactly the false positive this module exists to
    // avoid: a real place suppressed because its correct spelling looks
    // unfamiliar.
    assert.equal(isMalformedLocationValue("Hawai`i"), false);
    assert.equal(isMalformedLocationValue("San`a"), false);
});

test("balanced parentheses are a legitimate place-name shape, not a tell", () => {
    assert.equal(isMalformedLocationValue("Korea (South)"), false);
    assert.equal(isMalformedLocationValue("Congo (Kinshasa)"), false);
});

test("this corpus's own deliberate compound tag survives — single-spaced hyphen is not a tell", () => {
    assert.equal(isMalformedLocationValue("Canada - Toronto"), false);
    assert.equal(isMalformedLocationValue("United States - Remote"), false);
});

test("a hyphenated place name is not flagged just for containing a hyphen", () => {
    assert.equal(isMalformedLocationValue("Winston-Salem"), false);
    assert.equal(isMalformedLocationValue("Stratford-upon-Avon"), false);
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { countryToFlag } from "../../src/lib/jobs/country-flag";

// Flag chip (Himalayas-style, visual-identity pass 2026-08-01) — keyed off
// the SAME canonical country table country-classification.ts already
// validates `location_country` facet values against, so this only needs to
// cover the mapping/null behavior, not re-litigate which raw values classify
// as a country (that's jobs-country-classification.test.ts). There is no raw
// ISO-2 passthrough (removed 2026-08-20): it silently mislabeled US state
// codes like "AZ"/"CA"/"DE"/"IN" as Azerbaijan/Canada/Germany/India.
describe("countryToFlag", () => {
  it("known countries from the real ~country table map to their flag", () => {
    assert.equal(countryToFlag("Germany"), "🇩🇪");
    assert.equal(countryToFlag("Canada"), "🇨🇦");
    assert.equal(countryToFlag("India"), "🇮🇳");
    assert.equal(countryToFlag("Japan"), "🇯🇵");
    assert.equal(countryToFlag("Brazil"), "🇧🇷");
    assert.equal(countryToFlag("Kosovo"), "🇽🇰");
  });

  it("is case-insensitive and trims whitespace, matching classifyCountryValue", () => {
    assert.equal(countryToFlag("  germany  "), "🇩🇪");
    assert.equal(countryToFlag("CANADA"), "🇨🇦");
  });

  it("known aliases resolve to the ALIASED country's real ISO-2, not a passthrough guess", () => {
    // "UK" is a 2-letter-ish alias for United Kingdom, whose real ISO-3166
    // code is GB — this only passes if classification runs before passthrough.
    assert.equal(countryToFlag("UK"), "🇬🇧");
    assert.equal(countryToFlag("USA"), "🇺🇸");
  });

  it("unknown/junk country string returns null, not a broken glyph", () => {
    assert.equal(countryToFlag("London"), null);
    assert.equal(countryToFlag("Multiple Locations"), null);
    assert.equal(countryToFlag("Not A Real Place"), null);
  });

  it("empty or undefined input returns null", () => {
    assert.equal(countryToFlag(""), null);
    assert.equal(countryToFlag("   "), null);
    assert.equal(countryToFlag(null), null);
    assert.equal(countryToFlag(undefined), null);
  });

  it("a raw 2-letter code not recognized as a country name/alias returns null, not a passthrough guess", () => {
    // "DE" and "fr" aren't names/aliases classifyCountryValue recognizes (it
    // only knows "Germany"/"France") — regression test for the removed
    // ISO-2 passthrough: these must NOT resolve via code-point math anymore.
    assert.equal(countryToFlag("DE"), null);
    assert.equal(countryToFlag("fr"), null);
  });

  it("a 2-letter string that isn't a real ISO code also returns null (no passthrough to guess from)", () => {
    assert.equal(countryToFlag("XX"), null);
    assert.equal(countryToFlag("A"), null);
    assert.equal(countryToFlag("USAA"), null);
  });

  it("a US state code that collides with a real ISO-2 country code returns null, not the colliding country's flag", () => {
    // Live bug: "IN" (Indiana) must not render India's flag on a US posting.
    assert.equal(countryToFlag("IN"), null);
  });

  it("an array of unrecognized state codes returns null, not an empty-string join", () => {
    assert.equal(countryToFlag(["AZ", "AR"]), null);
  });

  it("canonical full country names still resolve, untouched by the passthrough removal", () => {
    assert.equal(countryToFlag("Germany"), "🇩🇪");
  });

  it("a mixed array keeps the recognized country's flag and silently skips the unrecognized state code", () => {
    assert.equal(countryToFlag(["Germany", "AZ"]), "🇩🇪");
  });

  // Multi-country postings (Subspace feed, 2026-08): location_country can
  // now arrive as an array. A plain string must still behave exactly as
  // above — these only cover the new array shape.
  it("an array of 2 distinct countries concatenates their flags, order preserved, no separator", () => {
    assert.equal(countryToFlag(["Germany", "Canada"]), "🇩🇪🇨🇦");
    assert.equal(countryToFlag(["Canada", "Germany"]), "🇨🇦🇩🇪");
  });

  it("an array skips unrecognized elements but keeps the recognized ones' flags", () => {
    assert.equal(countryToFlag(["Germany", "Not A Real Place"]), "🇩🇪");
  });

  it("an empty array and null both return null, matching today's empty/unrecognized behavior", () => {
    assert.equal(countryToFlag([]), null);
    assert.equal(countryToFlag(null), null);
    assert.equal(countryToFlag(["Not A Real Place"]), null);
  });
});

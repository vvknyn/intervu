import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { countryToFlag } from "../../src/lib/jobs/country-flag";

// Flag chip (Himalayas-style, visual-identity pass 2026-08-01) — keyed off
// the SAME canonical country table country-classification.ts already
// validates `location_country` facet values against, so this only needs to
// cover the mapping/passthrough/null behavior, not re-litigate which raw
// values classify as a country (that's jobs-country-classification.test.ts).
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

  it("ISO-2 passthrough for a raw 2-letter code not recognized as a country name", () => {
    // "DE" isn't a name/alias classifyCountryValue recognizes (it only
    // knows "Germany"), so this exercises the code-point-math passthrough.
    assert.equal(countryToFlag("DE"), "🇩🇪");
    assert.equal(countryToFlag("fr"), "🇫🇷");
  });

  it("a 2-letter string that isn't a real ISO code still returns a regional-indicator pair (no crash), a 3+/1-letter string returns null", () => {
    assert.equal(countryToFlag("XX"), "🇽🇽");
    assert.equal(countryToFlag("A"), null);
    assert.equal(countryToFlag("USAA"), null);
  });
});

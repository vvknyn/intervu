import { test } from "node:test";
import assert from "node:assert/strict";

import { capitalizeWords } from "../../src/lib/text-case";
import { facetValueLabel } from "../../src/components/jobs/FilterPanel";

/**
 * The defect these cover shipped and was visible on the /jobs location chip:
 * filtering on "Montréal" rendered "Location · MontréAl". The cause was
 * `replace(/\b\w/g, ...)` — `\w` is ASCII-only, so `\b` matches INSIDE any
 * word containing a diacritic and the letter after it gets upper-cased.
 */

test("capitalizes a word without breaking the diacritic inside it", () => {
    assert.equal(capitalizeWords("montréal"), "Montréal");
});

test("leaves an already-correct accented name untouched (the shipped defect)", () => {
    // This is the exact input that rendered "MontréAl" on prod.
    assert.equal(capitalizeWords("Montréal"), "Montréal");
});

test("holds for diacritics beyond the one that surfaced the bug", () => {
    // Deliberately NOT Montréal: the fix has to be about non-ASCII letters in
    // general, not about one city. Each of these has the accent in a
    // different position, and São Paulo also exercises a word boundary.
    assert.equal(capitalizeWords("zürich"), "Zürich");
    assert.equal(capitalizeWords("são paulo"), "São Paulo");
    assert.equal(capitalizeWords("kraków"), "Kraków");
    assert.equal(capitalizeWords("łódź"), "Łódź");
    assert.equal(capitalizeWords("québec city"), "Québec City");
    assert.equal(capitalizeWords("ñuñoa"), "Ñuñoa");
});

test("still starts a new word after each non-letter separator", () => {
    // The behaviour the old `\b\w` spelling was reaching for, preserved
    // exactly — a fix that quietly restyled every enum label would be a
    // different regression.
    assert.equal(capitalizeWords("full time"), "Full Time");
    assert.equal(capitalizeWords("entry-level"), "Entry-Level");
    assert.equal(capitalizeWords("r&d"), "R&D");
    assert.equal(capitalizeWords("st. john"), "St. John");
});

test("does not treat an apostrophe as a word start", () => {
    // The old `\b\w` spelling produced "John'S". An apostrophe binds into the
    // word instead, matching `titleCaseDisplay`'s own `[\p{L}\p{N}']+` word
    // class so the two helpers agree on where a word ends.
    assert.equal(capitalizeWords("john's"), "John's");
    // Accepted trade-off, asserted so it stays deliberate: "o'brien" and
    // "john's" are the same shape (letter, apostrophe, letter), so no rule
    // can capitalize one and not the other. Lowercase surnames are the rarer
    // input here — these labels are facet values and enum keys — and a
    // correctly-cased "O'Brien" arrives untouched either way, since only the
    // first letter of a word is ever rewritten.
    assert.equal(capitalizeWords("o'brien"), "O'brien");
    assert.equal(capitalizeWords("O'Brien"), "O'Brien");
});

test("is idempotent — re-labelling a label never drifts", () => {
    for (const input of ["montréal", "Montréal", "são paulo", "entry-level", "john's", "r&d"]) {
        const once = capitalizeWords(input);
        assert.equal(capitalizeWords(once), once, `drifted on ${input}`);
    }
});

test("leaves digits and empty input alone", () => {
    assert.equal(capitalizeWords(""), "");
    assert.equal(capitalizeWords("3d"), "3d");
    assert.equal(capitalizeWords("  "), "  ");
});

test("the location chip label round-trips an accented city unchanged", () => {
    // The regression guard at the surface the user actually sees. The chip
    // label must equal the committed filter value, or the chip is describing
    // a filter that is not the one running.
    assert.equal(facetValueLabel("location_country", "Montréal"), "Montréal");
    assert.equal(facetValueLabel("location_country", "Zürich"), "Zürich");
});

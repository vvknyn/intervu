import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { highlightMatch } from "../../src/lib/highlight-match";

describe("highlightMatch", () => {
    it("splits text into unmatched/matched/unmatched around a mid-string match", () => {
        assert.deepEqual(highlightMatch("Senior Product Manager", "Product"), [
            { text: "Senior ", matched: false },
            { text: "Product", matched: true },
            { text: " Manager", matched: false },
        ]);
    });

    it("matches case-insensitively but preserves the ORIGINAL text's casing in both segments", () => {
        assert.deepEqual(highlightMatch("Registered Nurse", "nurse"), [
            { text: "Registered ", matched: false },
            { text: "Nurse", matched: true },
        ]);
    });

    it("omits the leading unmatched segment when the match starts at index 0", () => {
        assert.deepEqual(highlightMatch("Electrician", "Elec"), [
            { text: "Elec", matched: true },
            { text: "trician", matched: false },
        ]);
    });

    it("omits the trailing unmatched segment when the match runs to the end", () => {
        assert.deepEqual(highlightMatch("Software Engineer", "Engineer"), [
            { text: "Software ", matched: false },
            { text: "Engineer", matched: true },
        ]);
    });

    it("returns the whole text as a single unmatched segment when the query is empty", () => {
        assert.deepEqual(highlightMatch("Truck Driver", ""), [{ text: "Truck Driver", matched: false }]);
        assert.deepEqual(highlightMatch("Truck Driver", "   "), [{ text: "Truck Driver", matched: false }]);
    });

    it("returns the whole text as a single unmatched segment when the query isn't found", () => {
        assert.deepEqual(highlightMatch("Truck Driver", "nurse"), [{ text: "Truck Driver", matched: false }]);
    });
});

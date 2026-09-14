import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { clampDeckIndex } from "../../src/lib/jobs/for-you/deck-index";

describe("clampDeckIndex", () => {
    it("clamps to 0 when the deck is empty", () => {
        assert.equal(clampDeckIndex(5, 0), 0);
        assert.equal(clampDeckIndex(0, 0), 0);
    });

    it("leaves an in-range index untouched", () => {
        assert.equal(clampDeckIndex(3, 10), 3);
    });

    it("pins to the last slot after skipping the second-to-last card of an 18-card deck", () => {
        // The QA repro's deck size — index unchanged, list shrinks by one.
        assert.equal(clampDeckIndex(17, 18), 17);
    });

    it("pins to the last slot in a differently-sized deck too", () => {
        assert.equal(clampDeckIndex(17, 5), 4);
    });

    it("never goes negative", () => {
        assert.equal(clampDeckIndex(-3, 10), 0);
    });
});

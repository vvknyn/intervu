import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    computeDeckDragOffset,
    DECK_DRAG_MAX_SHIFT_RATIO,
    resolveDeckSwipe,
} from "../../src/lib/jobs/for-you/deck-swipe";

describe("resolveDeckSwipe", () => {
    it("ignores short or mostly-vertical gestures", () => {
        assert.equal(resolveDeckSwipe({ dx: 20, dy: 0 }), null);
        assert.equal(resolveDeckSwipe({ dx: 80, dy: 120 }), null);
    });

    it("maps left swipe to next and right swipe to previous", () => {
        assert.equal(resolveDeckSwipe({ dx: -80, dy: 10 }), "next");
        assert.equal(resolveDeckSwipe({ dx: 80, dy: -8 }), "previous");
    });

    it("clamps drag follow to deck shift ratio", () => {
        const width = 400;
        const max = width * DECK_DRAG_MAX_SHIFT_RATIO;
        assert.equal(computeDeckDragOffset(999, width), max);
        assert.equal(computeDeckDragOffset(-999, width), -max);
        assert.equal(computeDeckDragOffset(20, width), 20);
    });
});

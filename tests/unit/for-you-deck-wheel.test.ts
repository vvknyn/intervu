import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    shouldAdvancePackOnSwipe,
    shouldAdvancePackOnWheel,
} from "../../src/lib/jobs/for-you/deck-wheel";

describe("shouldAdvancePackOnWheel", () => {
    it("returns false when the target is inside data-pack-scroll", () => {
        const scroll = {
            closest(selector: string) {
                return selector === "[data-pack-scroll]" ? scroll : null;
            },
        };
        assert.equal(shouldAdvancePackOnWheel(scroll as unknown as EventTarget), false);
    });

    it("returns true when the target is outside the scroll region", () => {
        const outer = { closest: () => null };
        assert.equal(shouldAdvancePackOnWheel(outer as unknown as EventTarget), true);
    });

    it("returns true for a null target", () => {
        assert.equal(shouldAdvancePackOnWheel(null), true);
    });

    it("returns true when the target is only inside data-pack-meta-scroll", () => {
        const meta = {
            closest(selector: string) {
                return selector === "[data-pack-meta-scroll]" ? meta : null;
            },
        };
        assert.equal(shouldAdvancePackOnWheel(meta as unknown as EventTarget), true);
    });
});

describe("shouldAdvancePackOnSwipe", () => {
    const mid = { scrollTop: 80, clientHeight: 200, scrollHeight: 400 };
    const top = { scrollTop: 0, clientHeight: 200, scrollHeight: 400 };
    const bottom = { scrollTop: 200, clientHeight: 200, scrollHeight: 400 };
    const short = { scrollTop: 0, clientHeight: 200, scrollHeight: 200 };

    it("advances outside any inner scroller", () => {
        assert.equal(shouldAdvancePackOnSwipe(-50, null), true);
        assert.equal(shouldAdvancePackOnSwipe(50, null), true);
    });

    it("does not steal mid-pane JD or meta scroll", () => {
        assert.equal(shouldAdvancePackOnSwipe(-50, mid), false);
        assert.equal(shouldAdvancePackOnSwipe(50, mid), false);
    });

    it("advances to the next pack when swiping up at the bottom edge", () => {
        assert.equal(shouldAdvancePackOnSwipe(-50, bottom), true);
        assert.equal(shouldAdvancePackOnSwipe(-50, top), false);
    });

    it("advances to the previous pack when swiping down at the top edge", () => {
        assert.equal(shouldAdvancePackOnSwipe(50, top), true);
        assert.equal(shouldAdvancePackOnSwipe(50, bottom), false);
    });

    it("treats a non-overflowing pane as an edge in both directions", () => {
        assert.equal(shouldAdvancePackOnSwipe(-50, short), true);
        assert.equal(shouldAdvancePackOnSwipe(50, short), true);
    });
});

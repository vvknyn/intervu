import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    regionHasScrollRoom,
    shouldPackGestureAdvanceDeck,
} from "../../src/lib/jobs/for-you/deck-wheel";

type Metrics = { scrollTop: number; clientHeight: number; scrollHeight: number };

/** A duck-typed scroll region: matches the same `.overflow-y-auto` /
 *  `.overflow-y-scroll` selector every real scroller in the pack needs in
 *  order to actually scroll — no `data-pack-*` attribute involved. */
function scrollable(metrics: Metrics) {
    return {
        ...metrics,
        closest(selector: string) {
            return selector === ".overflow-y-auto, .overflow-y-scroll" ? this : null;
        },
    };
}

describe("regionHasScrollRoom", () => {
    it("has no room in either direction when content does not overflow", () => {
        const short: Metrics = { scrollTop: 0, clientHeight: 200, scrollHeight: 200 };
        assert.equal(regionHasScrollRoom(short, 1), false);
        assert.equal(regionHasScrollRoom(short, -1), false);
    });

    it("has room forward until the bottom edge and backward until the top edge", () => {
        const mid: Metrics = { scrollTop: 80, clientHeight: 200, scrollHeight: 400 };
        assert.equal(regionHasScrollRoom(mid, 1), true);
        assert.equal(regionHasScrollRoom(mid, -1), true);
        const top: Metrics = { scrollTop: 0, clientHeight: 200, scrollHeight: 400 };
        assert.equal(regionHasScrollRoom(top, -1), false);
        const bottom: Metrics = { scrollTop: 200, clientHeight: 200, scrollHeight: 400 };
        assert.equal(regionHasScrollRoom(bottom, 1), false);
    });
});

describe("shouldPackGestureAdvanceDeck", () => {
    it("advances outside any scrollable region", () => {
        const outer = { closest: () => null };
        assert.equal(shouldPackGestureAdvanceDeck(outer as unknown as EventTarget, 1), true);
    });

    it("advances for a null target", () => {
        assert.equal(shouldPackGestureAdvanceDeck(null, 1), true);
    });

    it("does not advance a wheel gesture over an overflowing meta pane (defect repro)", () => {
        const meta = scrollable({ scrollTop: 0, clientHeight: 100, scrollHeight: 400 });
        assert.equal(shouldPackGestureAdvanceDeck(meta as unknown as EventTarget, 1), false);
    });

    it("advances a wheel gesture over a non-overflowing meta pane", () => {
        const meta = scrollable({ scrollTop: 0, clientHeight: 100, scrollHeight: 100 });
        assert.equal(shouldPackGestureAdvanceDeck(meta as unknown as EventTarget, 1), true);
    });

    it("does not advance over the description pane (already-working case)", () => {
        const jd = scrollable({ scrollTop: 0, clientHeight: 300, scrollHeight: 900 });
        assert.equal(shouldPackGestureAdvanceDeck(jd as unknown as EventTarget, 1), false);
    });

    it("is edge-aware: falls through to the deck once a region has nowhere left to go", () => {
        const bottom = scrollable({ scrollTop: 200, clientHeight: 200, scrollHeight: 400 });
        assert.equal(shouldPackGestureAdvanceDeck(bottom as unknown as EventTarget, 1), true);
        assert.equal(shouldPackGestureAdvanceDeck(bottom as unknown as EventTarget, -1), false);
        const top = scrollable({ scrollTop: 0, clientHeight: 200, scrollHeight: 400 });
        assert.equal(shouldPackGestureAdvanceDeck(top as unknown as EventTarget, -1), true);
        assert.equal(shouldPackGestureAdvanceDeck(top as unknown as EventTarget, 1), false);
    });

    it("covers a third scroller region neither gesture path was written for", () => {
        // A brand-new pane (e.g. a fit-score breakdown) with no data-pack-*
        // marker at all — only the overflow-y utility class that makes it
        // scroll in the first place. Both directions behave correctly with
        // zero code written specifically for this region.
        const notesPane = scrollable({ scrollTop: 0, clientHeight: 100, scrollHeight: 500 });
        assert.equal(shouldPackGestureAdvanceDeck(notesPane as unknown as EventTarget, 1), false);
        assert.equal(shouldPackGestureAdvanceDeck(notesPane as unknown as EventTarget, -1), true);
    });
});

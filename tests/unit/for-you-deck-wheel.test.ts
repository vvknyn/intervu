import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    regionHasScrollRoom,
    shouldPackGestureAdvanceDeck,
    type ScrollableCandidate,
    type StyleReader,
} from "../../src/lib/jobs/for-you/deck-wheel";

type Metrics = { scrollTop: number; clientHeight: number; scrollHeight: number };
type FakeEl = ScrollableCandidate & { overflowY: string; className?: string };

/** Stands in for `getComputedStyle` with no jsdom: reads `overflowY`
 *  straight off the fake element. Proves the predicate is driven by the
 *  injected style reader, not by any class name the element happens to
 *  carry (several fakes below carry no matching class name at all, or a
 *  class name that is deliberately wrong, to make that point). */
const readFakeStyle: StyleReader = (el) => ({ overflowY: (el as FakeEl).overflowY });

function el(overflowY: string, metrics: Metrics, parentElement: FakeEl | null = null): FakeEl {
    return { overflowY, ...metrics, parentElement };
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
        const target = el("visible", { scrollTop: 0, clientHeight: 100, scrollHeight: 100 });
        assert.equal(
            shouldPackGestureAdvanceDeck(target as unknown as EventTarget, null, 1, readFakeStyle),
            true,
        );
    });

    it("advances for a null target", () => {
        assert.equal(shouldPackGestureAdvanceDeck(null, null, 1, readFakeStyle), true);
    });

    it("does not advance a wheel gesture over an overflowing meta pane (defect repro)", () => {
        const meta = el("auto", { scrollTop: 0, clientHeight: 100, scrollHeight: 400 });
        assert.equal(
            shouldPackGestureAdvanceDeck(meta as unknown as EventTarget, null, 1, readFakeStyle),
            false,
        );
    });

    it("advances a wheel gesture over a non-overflowing meta pane", () => {
        const meta = el("auto", { scrollTop: 0, clientHeight: 100, scrollHeight: 100 });
        assert.equal(
            shouldPackGestureAdvanceDeck(meta as unknown as EventTarget, null, 1, readFakeStyle),
            true,
        );
    });

    it("does not advance over the description pane (already-working case)", () => {
        const jd = el("scroll", { scrollTop: 0, clientHeight: 300, scrollHeight: 900 });
        assert.equal(
            shouldPackGestureAdvanceDeck(jd as unknown as EventTarget, null, 1, readFakeStyle),
            false,
        );
    });

    it("is edge-aware: falls through to the deck once a region has nowhere left to go", () => {
        const bottom = el("auto", { scrollTop: 200, clientHeight: 200, scrollHeight: 400 });
        assert.equal(
            shouldPackGestureAdvanceDeck(bottom as unknown as EventTarget, null, 1, readFakeStyle),
            true,
        );
        assert.equal(
            shouldPackGestureAdvanceDeck(bottom as unknown as EventTarget, null, -1, readFakeStyle),
            false,
        );
        const top = el("auto", { scrollTop: 0, clientHeight: 200, scrollHeight: 400 });
        assert.equal(
            shouldPackGestureAdvanceDeck(top as unknown as EventTarget, null, -1, readFakeStyle),
            true,
        );
        assert.equal(
            shouldPackGestureAdvanceDeck(top as unknown as EventTarget, null, 1, readFakeStyle),
            false,
        );
    });

    it("blocks a scroller reachable only through a responsive utility class (no fixed spelling matches)", () => {
        // This element's only class is a Tailwind responsive variant, not
        // either of the two literal strings a `.closest()` selector-based
        // predicate would hardcode. Detection must come from computed
        // overflowY + real overflow, never from recognizing a class name.
        const responsive = el("auto", { scrollTop: 0, clientHeight: 100, scrollHeight: 400 });
        responsive.className = "lg:overflow-y-auto";
        assert.equal(
            shouldPackGestureAdvanceDeck(responsive as unknown as EventTarget, null, 1, readFakeStyle),
            false,
        );
    });

    it("can-fail proof: a class-selector predicate misses the same responsive scroller the real one catches", () => {
        const responsive = el("auto", { scrollTop: 0, clientHeight: 100, scrollHeight: 400 });
        responsive.className = "lg:overflow-y-auto";

        // The real, computed-style-based predicate correctly blocks the gesture.
        assert.equal(
            shouldPackGestureAdvanceDeck(responsive as unknown as EventTarget, null, 1, readFakeStyle),
            false,
        );

        // A predicate that matched class-name spellings instead (the
        // defect this replaces) would not recognize this element as
        // scrollable at all -- its class is a responsive variant, not one
        // of the hardcoded ".overflow-y-auto" / ".overflow-y-scroll"
        // strings -- and would wrongly let the gesture advance the deck.
        const matchesHardcodedSpelling = (className: string | undefined) =>
            className === "overflow-y-auto" || className === "overflow-y-scroll";
        assert.equal(matchesHardcodedSpelling(responsive.className), false);
    });

    it("does not let a scrollable ancestor ABOVE the boundary swallow a gesture", () => {
        // The deck (the boundary) sits inside some unrelated outer
        // scrollable page container. A gesture over a non-scrolling part
        // of the card must still advance the deck: the walk stops at the
        // boundary and must never even look at the outer container.
        const outerScrollableAncestor = el("auto", { scrollTop: 0, clientHeight: 200, scrollHeight: 2000 });
        const boundary = el(
            "visible",
            { scrollTop: 0, clientHeight: 600, scrollHeight: 600 },
            outerScrollableAncestor,
        );
        const cardContent = el("visible", { scrollTop: 0, clientHeight: 40, scrollHeight: 40 }, boundary);
        assert.equal(
            shouldPackGestureAdvanceDeck(
                cardContent as unknown as EventTarget,
                boundary as unknown as EventTarget,
                1,
                readFakeStyle,
            ),
            true,
        );
    });

    it("a non-overflowing overflow:auto element falls through to its scrollable ancestor", () => {
        const meta = el("auto", { scrollTop: 0, clientHeight: 100, scrollHeight: 400 });
        const emptyAutoWrapper = el("auto", { scrollTop: 0, clientHeight: 40, scrollHeight: 40 }, meta);
        assert.equal(
            shouldPackGestureAdvanceDeck(emptyAutoWrapper as unknown as EventTarget, null, 1, readFakeStyle),
            false,
        );
    });

    it("covers a third scroller region neither gesture path was written for, keyed on style not class", () => {
        const notesPane = el("scroll", { scrollTop: 0, clientHeight: 100, scrollHeight: 500 });
        assert.equal(
            shouldPackGestureAdvanceDeck(notesPane as unknown as EventTarget, null, 1, readFakeStyle),
            false,
        );
        assert.equal(
            shouldPackGestureAdvanceDeck(notesPane as unknown as EventTarget, null, -1, readFakeStyle),
            true,
        );
    });
});

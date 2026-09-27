import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    DECK_POINTER_ACTIVATE_DX_PX,
    isVerticalDominantMove,
    shouldActivateDeckHorizontalDrag,
} from "../../src/lib/jobs/for-you/deck-pointer-intent";

describe("deck pointer horizontal intent", () => {
    it("does not activate below threshold or when vertical-dominant", () => {
        assert.equal(
            shouldActivateDeckHorizontalDrag({ dx: 4, dy: 0, alreadyActivated: false }),
            false,
        );
        assert.equal(
            shouldActivateDeckHorizontalDrag({
                dx: DECK_POINTER_ACTIVATE_DX_PX + 4,
                dy: 80,
                alreadyActivated: false,
            }),
            false,
        );
        assert.equal(
            shouldActivateDeckHorizontalDrag({
                dx: 40,
                dy: 2,
                alreadyActivated: false,
            }),
            true,
        );
    });

    it("classifies vertical-dominant moves", () => {
        assert.equal(isVerticalDominantMove(10, 40), true);
        assert.equal(isVerticalDominantMove(40, 10), false);
    });

    it("ForYouDeck defers pointer capture until horizontal activation", () => {
        const deck = readFileSync(
            join(__dirname, "../../src/components/jobs/for-you/ForYouDeck.tsx"),
            "utf8",
        );
        assert.match(deck, /shouldActivateDeckHorizontalDrag/);
        assert.match(deck, /onPointerCancel=\{handlePointerCancel\}/);
        assert.doesNotMatch(deck, /onPointerDown[\s\S]*setPointerCapture/);
    });
});

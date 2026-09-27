import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    DECK_ANIMATION_NAME,
    deckCommitUsesDeckAnimation,
    expectedDeckAnimationName,
    flushInstantDeckCommit,
    reduceDeckAnimationEnd,
    shouldAcceptDeckAnimationEnd,
} from "../../src/lib/jobs/for-you/deck-motion-lifecycle";

describe("deck motion lifecycle (pure)", () => {
    it("maps phase/role/direction to CSS animation names", () => {
        assert.equal(
            expectedDeckAnimationName("commit-out", "outgoing", "next"),
            DECK_ANIMATION_NAME.exitNext,
        );
        assert.equal(
            expectedDeckAnimationName("commit-in", "incoming", "previous"),
            DECK_ANIMATION_NAME.enterPrevious,
        );
        assert.equal(expectedDeckAnimationName("idle", "incoming", "next"), null);
    });

    it("accepts only matching animationend on the layer element", () => {
        const layer = { id: "layer" };
        const child = { id: "child" };
        assert.equal(
            shouldAcceptDeckAnimationEnd({
                phase: "commit-out",
                role: "outgoing",
                direction: "next",
                animationName: DECK_ANIMATION_NAME.exitNext,
                eventTarget: layer,
                currentTarget: layer,
            }),
            true,
        );
        assert.equal(
            shouldAcceptDeckAnimationEnd({
                phase: "commit-out",
                role: "outgoing",
                direction: "next",
                animationName: DECK_ANIMATION_NAME.exitNext,
                eventTarget: child,
                currentTarget: layer,
            }),
            false,
        );
        assert.equal(
            shouldAcceptDeckAnimationEnd({
                phase: "commit-out",
                role: "outgoing",
                direction: "next",
                animationName: "success-pulse-keyframes",
                eventTarget: layer,
                currentTarget: layer,
            }),
            false,
        );
    });

    it("skips animated commit when reduced motion (no animationend dependency)", () => {
        assert.equal(deckCommitUsesDeckAnimation(true), false);
        assert.equal(deckCommitUsesDeckAnimation(false), true);
        assert.deepEqual(
            flushInstantDeckCommit({ reducedMotion: true, phase: "commit-cross", direction: "next" }),
            { action: "reset-idle" },
        );
        assert.deepEqual(
            flushInstantDeckCommit({ reducedMotion: true, phase: "commit-out", direction: "previous" }),
            { action: "navigate-then-idle", direction: "previous" },
        );
        assert.deepEqual(
            flushInstantDeckCommit({ reducedMotion: false, phase: "commit-out", direction: "next" }),
            { action: "none" },
        );
    });

    it("reduces animation end to navigate, enter-incoming, or reset-idle", () => {
        assert.deepEqual(reduceDeckAnimationEnd("commit-out", "outgoing"), { kind: "enter-incoming" });
        assert.deepEqual(reduceDeckAnimationEnd("commit-in", "incoming"), { kind: "reset-idle" });
        assert.deepEqual(reduceDeckAnimationEnd("commit-cross", "incoming"), { kind: "reset-idle" });
        assert.deepEqual(reduceDeckAnimationEnd("commit-cross", "outgoing"), { kind: "noop" });
    });

    it("ForYouDeck wires onAnimationEnd (not transitionend) for commit layers", () => {
        const deck = readFileSync(
            join(__dirname, "../../src/components/jobs/for-you/ForYouDeck.tsx"),
            "utf8",
        );
        assert.match(deck, /onAnimationEnd=\{handleLayerAnimationEnd/);
        assert.match(deck, /shouldAcceptDeckAnimationEnd/);
        assert.doesNotMatch(deck, /onTransitionEnd=\{\(\) => onMotionEnd/);
        assert.match(deck, /useSyncExternalStore/);
        assert.match(deck, /flushInstantDeckCommit/);
        assert.match(deck, /prefersReducedMotion\(\)/);
        assert.doesNotMatch(deck, /reducedMotionRef/);
    });
});

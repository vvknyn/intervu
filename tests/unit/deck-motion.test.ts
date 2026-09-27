import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");

describe("deck motion contract", () => {
    it("globals.css declares deck shift and enter/exit utilities", () => {
        const css = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");
        assert.match(css, /--motion-deck-shift:\s*12%/);
        assert.match(css, /\.deck-enter-next/);
        assert.match(css, /\.deck-exit-next/);
        assert.match(css, /var\(--transition-deck\)/);
    });

    it("ForYouDeck uses reduced-motion guard and commit-only dual render", () => {
        const deck = readFileSync(join(ROOT, "src/components/jobs/for-you/ForYouDeck.tsx"), "utf8");
        assert.match(deck, /prefersReducedMotion/);
        assert.match(deck, /commit-cross/);
        assert.match(deck, /onAnimationEnd/);
        assert.match(deck, /reduceDeckAnimationEnd/);
        assert.match(deck, /deckCommitUsesDeckAnimation/);
        assert.match(deck, /getPrefersReducedMotionSnapshot/);
        assert.doesNotMatch(deck, /reducedMotionRef/);
        assert.doesNotMatch(deck, /framer-motion/);
        assert.doesNotMatch(deck, /ViewTransition/);
    });
});

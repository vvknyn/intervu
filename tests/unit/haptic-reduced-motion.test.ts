import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hapticTap } from "../../src/lib/motion/haptic";

const HAPTIC_SRC = readFileSync(join(__dirname, "../../src/lib/motion/haptic.ts"), "utf8");

describe("hapticTap reduced-motion guard", () => {
    it("source gates navigator.vibrate on prefersReducedMotion", () => {
        assert.match(HAPTIC_SRC, /prefersReducedMotion\(\)/);
        assert.match(HAPTIC_SRC, /navigator\.vibrate/);
        assert.doesNotMatch(HAPTIC_SRC, /import.*framer/);
    });

    it("is safe when vibrate is missing", () => {
        const prev = navigator.vibrate;
        // @ts-expect-error test stub
        navigator.vibrate = undefined;
        assert.doesNotThrow(() => hapticTap("light"));
        navigator.vibrate = prev;
    });
});

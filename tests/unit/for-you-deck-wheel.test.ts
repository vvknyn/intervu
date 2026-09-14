import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shouldAdvancePackOnWheel } from "../../src/lib/jobs/for-you/deck-wheel";

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
});

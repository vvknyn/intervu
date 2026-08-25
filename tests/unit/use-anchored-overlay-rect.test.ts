import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { measureAnchoredOverlayRect } from "../../src/lib/use-anchored-overlay-rect";

describe("measureAnchoredOverlayRect", () => {
    it("hangs the overlay below the anchor with the default 8px gap", () => {
        const anchor = {
            getBoundingClientRect: () => ({
                top: 10,
                bottom: 50,
                left: 20,
                width: 200,
                height: 40,
                right: 220,
                x: 20,
                y: 10,
                toJSON() {
                    return this;
                },
            }),
        } as HTMLElement;
        assert.deepEqual(measureAnchoredOverlayRect(anchor), { top: 58, left: 20, width: 200 });
    });
});

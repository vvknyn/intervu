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

    const box = (top: number, bottom: number, left: number, right: number) =>
        ({
            getBoundingClientRect: () => ({
                top,
                bottom,
                left,
                right,
                width: right - left,
                height: bottom - top,
                x: left,
                y: top,
                toJSON() {
                    return this;
                },
            }),
        }) as HTMLElement;

    // A phone stacks the location row under the search box: the suggestions
    // covered it, so it could not be tapped while they were open (focus
    // group, 2026-10-12).
    it("hangs below a control stacked under the anchor, so the control stays tappable", () => {
        const search = box(10, 54, 16, 374);
        const locationRow = box(54, 98, 16, 374);
        assert.deepEqual(measureAnchoredOverlayRect(search, 8, locationRow), { top: 106, left: 16, width: 358 });
    });

    it("ignores a control beside the anchor (desktop puts location to the right)", () => {
        const search = box(10, 54, 16, 600);
        const locationBeside = box(10, 54, 610, 820);
        assert.deepEqual(measureAnchoredOverlayRect(search, 8, locationBeside), { top: 62, left: 16, width: 584 });
    });

    it("ignores a hidden control", () => {
        const search = box(10, 54, 16, 374);
        const hidden = box(0, 0, 0, 0);
        assert.deepEqual(measureAnchoredOverlayRect(search, 8, hidden), { top: 62, left: 16, width: 358 });
    });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deckWindowRange } from "../../src/lib/jobs/for-you/window-list";

describe("deckWindowRange", () => {
    it("mounts a window around the scrollport, not the whole list", () => {
        const range = deckWindowRange({
            scrollTop: 0,
            viewport: 600,
            count: 400,
            rowHeight: 100,
            overscan: 2,
        });
        assert.equal(range.start, 0);
        assert.ok(range.end < 40);
        assert.equal(range.padTop, 0);
        assert.ok(range.padBottom > 0);
    });

    it("pads above rows that have scrolled out", () => {
        const range = deckWindowRange({
            scrollTop: 2000,
            viewport: 400,
            count: 300,
            rowHeight: 100,
            overscan: 2,
        });
        assert.equal(range.start, 18);
        assert.equal(range.padTop, 1800);
        assert.ok(range.end > range.start);
        assert.ok(range.end < 300);
    });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const OVERLAY = join(__dirname, "..", "..", "src", "components", "tour", "TourOverlay.tsx");

describe("TourOverlay single-step chrome", () => {
    it("hides Previous when the tour is only one step", () => {
        const src = readFileSync(OVERLAY, "utf8");
        assert.match(src, /steps\.length === 1/);
        assert.match(src, /Previous/);
        assert.match(src, /isSingleStep/);
        assert.match(src, /stopTour/);
    });
});

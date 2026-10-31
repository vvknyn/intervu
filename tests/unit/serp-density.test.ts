import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { filtersOnScreen, resolveFiltersSurface } from "@/lib/jobs/serp-density";

describe("resolveFiltersSurface", () => {
    it("a phone gets the bottom sheet, with or without results", () => {
        assert.equal(resolveFiltersSurface({ isLgUp: false, resultsShown: true }), "sheet");
        assert.equal(resolveFiltersSurface({ isLgUp: false, resultsShown: false }), "sheet");
    });

    it("a laptop with a list gets the rail beside it", () => {
        assert.equal(resolveFiltersSurface({ isLgUp: true, resultsShown: true }), "rail");
    });

    it("a laptop with no list yet has nothing to put a column beside, so the drawer", () => {
        assert.equal(resolveFiltersSurface({ isLgUp: true, resultsShown: false }), "drawer");
    });
});

describe("filtersOnScreen", () => {
    it("the rail is on screen until it is hidden, whatever the overlay flag says", () => {
        assert.equal(filtersOnScreen({ surface: "rail", railHidden: false, overlayOpen: false }), true);
        assert.equal(filtersOnScreen({ surface: "rail", railHidden: true, overlayOpen: true }), false);
    });

    it("a drawer or sheet is on screen only while open, whatever the rail flag says", () => {
        for (const surface of ["drawer", "sheet"] as const) {
            assert.equal(filtersOnScreen({ surface, railHidden: false, overlayOpen: false }), false);
            assert.equal(filtersOnScreen({ surface, railHidden: true, overlayOpen: true }), true);
        }
    });
});

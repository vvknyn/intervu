import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveFacetsMountSite, showsFiltersToggle } from "@/lib/jobs/serp-density";

describe("resolveFacetsMountSite", () => {
    const at = (o: Partial<Parameters<typeof resolveFacetsMountSite>[0]>) =>
        resolveFacetsMountSite({
            isXlUp: false,
            isLgUp: false,
            filtersOpen: false,
            ...o,
        });

    it("picks the sheet below lg and the inline expand at or above it", () => {
        assert.equal(at({ isLgUp: false, filtersOpen: true }), "sheet");
        assert.equal(at({ isLgUp: true, filtersOpen: true }), "inline");
    });

    it("nothing mounts when nothing is open", () => {
        assert.equal(at({}), null);
        assert.equal(at({ isLgUp: true }), null);
    });
});

describe("showsFiltersToggle", () => {
    it("always shows the Filters toggle", () => {
        assert.equal(showsFiltersToggle(null), true);
        assert.equal(showsFiltersToggle("inline"), true);
        assert.equal(showsFiltersToggle("sheet"), true);
    });
});

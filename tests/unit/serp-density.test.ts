import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    DEFAULT_SERP_DENSITY,
    parseSerpDensity,
    resolveFacetsMountSite,
    showsFiltersToggle,
    type SerpDensity,
} from "@/lib/jobs/serp-density";

/**
 * The rule these tests exist to hold: dense is an xl+ affordance and NOTHING
 * else. A narrow window must behave identically in both layouts — otherwise
 * the switch quietly changes mobile too, which nobody asked for and nobody
 * would find.
 */

const DENSITIES: SerpDensity[] = ["comfortable", "dense"];

describe("parseSerpDensity", () => {
    it("round-trips both real values", () => {
        for (const d of DENSITIES) assert.equal(parseSerpDensity(d), d);
    });

    it("falls back for anything else, including a stale or hand-edited value", () => {
        for (const bad of [null, undefined, "", "DENSE", "compact", "true", "0"]) {
            assert.equal(parseSerpDensity(bad), DEFAULT_SERP_DENSITY);
        }
    });

    it("defaults to comfortable — dense must be chosen, never inherited", () => {
        assert.equal(DEFAULT_SERP_DENSITY, "comfortable");
    });
});

describe("resolveFacetsMountSite", () => {
    const at = (o: Partial<Parameters<typeof resolveFacetsMountSite>[0]>) =>
        resolveFacetsMountSite({
            density: "comfortable",
            isXlUp: false,
            isLgUp: false,
            filtersOpen: false,
            ...o,
        });

    it("mounts the rail at xl in dense, with nothing opened", () => {
        // The rail is standing furniture: there is no expand to trigger it.
        assert.equal(at({ density: "dense", isXlUp: true, isLgUp: true }), "rail");
    });

    it("keeps the rail up while filters are 'open' — open is meaningless there", () => {
        assert.equal(
            at({ density: "dense", isXlUp: true, isLgUp: true, filtersOpen: true }),
            "rail",
        );
    });

    /**
     * The load-bearing case. Below xl there is no third column to stand a rail
     * in, so dense MUST degrade to exactly what comfortable does — not to
     * "nothing", which would leave a narrow dense window with no way to filter
     * at all.
     */
    it("below xl, dense and comfortable are indistinguishable at every width", () => {
        for (const [isXlUp, isLgUp, filtersOpen] of [
            [false, true, true],
            [false, true, false],
            [false, false, true],
            [false, false, false],
        ] as const) {
            assert.equal(
                at({ density: "dense", isXlUp, isLgUp, filtersOpen }),
                at({ density: "comfortable", isXlUp, isLgUp, filtersOpen }),
                `xl=${isXlUp} lg=${isLgUp} open=${filtersOpen}`,
            );
        }
    });

    it("comfortable at xl still uses the transient expand, never a rail", () => {
        assert.equal(
            at({ density: "comfortable", isXlUp: true, isLgUp: true, filtersOpen: true }),
            "inline",
        );
        assert.equal(at({ density: "comfortable", isXlUp: true, isLgUp: true }), null);
    });

    it("picks the sheet below lg and the inline expand at or above it", () => {
        assert.equal(at({ isLgUp: false, filtersOpen: true }), "sheet");
        assert.equal(at({ isLgUp: true, filtersOpen: true }), "inline");
    });

    it("nothing mounts when nothing is open and no rail applies", () => {
        assert.equal(at({}), null);
        assert.equal(at({ isLgUp: true }), null);
    });
});

describe("showsFiltersToggle", () => {
    /**
     * The button exists to reveal the panel. When the rail already shows it,
     * the button would reveal something visible — so it stands down, and ONLY
     * then.
     */
    it("hides only for the rail", () => {
        assert.equal(showsFiltersToggle("rail"), false);
        assert.equal(showsFiltersToggle("inline"), true);
        assert.equal(showsFiltersToggle("sheet"), true);
        assert.equal(showsFiltersToggle(null), true);
    });

    /**
     * Negative control: a guard that can never fail is worthless. If the rail
     * ever stopped being reachable, the test above would still pass while
     * proving nothing — so assert the rail IS reachable from real inputs.
     */
    it("negative control: the rail is actually reachable, so the false branch is live", () => {
        const site = resolveFacetsMountSite({
            density: "dense",
            isXlUp: true,
            isLgUp: true,
            filtersOpen: false,
        });
        assert.equal(site, "rail");
        assert.equal(showsFiltersToggle(site), false);
    });
});

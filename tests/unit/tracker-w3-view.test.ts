import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { showDailyPlan } from "@/lib/pursuits/daily-apply-plan";
import { trackerBoardLayout, trackerLanesToRender } from "@/lib/pursuits/tracker-display";

describe("showDailyPlan — the N/12 line appears only once pace is real", () => {
    it("hidden below 10, shown from 10", () => {
        assert.equal(showDailyPlan(0), false);
        assert.equal(showDailyPlan(9), false);
        assert.equal(showDailyPlan(10), true);
        assert.equal(showDailyPlan(12), true);
        assert.equal(showDailyPlan(15), true);
    });
});

describe("tracker board: lanes on wide, tabs on phones", () => {
    it("layout follows the md breakpoint", () => {
        assert.equal(trackerBoardLayout(true), "lanes");
        assert.equal(trackerBoardLayout(false), "tabs");
    });

    it("lanes layout renders every lane", () => {
        assert.deepEqual(trackerLanesToRender("lanes", null, "applied"), ["saved", "applied", "interviewing", "offer", "closed"]);
    });

    it("tabs layout renders only the active tab, for any tab", () => {
        for (const tab of ["saved", "applied", "interviewing", "offer", "closed"] as const) {
            assert.deepEqual(trackerLanesToRender("tabs", null, tab), [tab]);
        }
    });

    it("a ?stage= filter wins in both layouts", () => {
        assert.deepEqual(trackerLanesToRender("lanes", "offer", "saved"), ["offer"]);
        assert.deepEqual(trackerLanesToRender("tabs", "offer", "saved"), ["offer"]);
    });
});

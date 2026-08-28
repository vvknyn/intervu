import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { interpretLoadMoreResponse } from "../../src/lib/jobs/load-more-outcome";

describe("interpretLoadMoreResponse", () => {
    it("a gated response (anonymous depth wall) is 'gated' regardless of what hits/total say", () => {
        // The refused response's own hits/total are 0 — proving the outcome
        // comes from `gated`, not from received/requested arithmetic that
        // would otherwise also read as "exhausted".
        assert.equal(
            interpretLoadMoreResponse({ gated: true, received: 0, requested: 20 }),
            "gated",
        );
    });

    it("a short final page that ISN'T gated is the natural end of results, not a gate", () => {
        assert.equal(
            interpretLoadMoreResponse({ gated: false, received: 7, requested: 20 }),
            "exhausted",
        );
    });

    it("a full page is appended", () => {
        assert.equal(
            interpretLoadMoreResponse({ gated: false, received: 20, requested: 20 }),
            "appended",
        );
    });

    it("an empty, non-gated page (zero hits left) is exhausted, not gated", () => {
        assert.equal(
            interpretLoadMoreResponse({ gated: false, received: 0, requested: 20 }),
            "exhausted",
        );
    });
});

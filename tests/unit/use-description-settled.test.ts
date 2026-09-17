import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { descriptionState } from "../../src/components/jobs/use-description-settled";

describe("descriptionState", () => {
    it("is pending before the detail fetch has hydrated the job", () => {
        assert.equal(descriptionState({ description: undefined, descriptionPending: false }), "pending");
    });

    it("is pending while hydrated but the live fill is still running", () => {
        assert.equal(descriptionState({ description: "", descriptionPending: true }), "pending");
    });

    it("is empty once hydrated with a confirmed-empty description (empty string)", () => {
        assert.equal(descriptionState({ description: "", descriptionPending: false }), "empty");
    });

    it("is empty for a whitespace-only description — formatDescription strips it to no blocks", () => {
        assert.equal(descriptionState({ description: "   \n\n  ", descriptionPending: false }), "empty");
    });

    it("is ready once a real description body is present", () => {
        assert.equal(
            descriptionState({ description: "We are looking for a senior engineer to join the team.", descriptionPending: false }),
            "ready",
        );
    });

    it("is ready even while descriptionPending is stale-true, since blocks already won", () => {
        // Mirrors resolveDescriptionSectionState's own "hasBlocks wins over
        // everything" rule — a teaser body already renders even mid-fill.
        assert.equal(
            descriptionState({ description: "We are looking for a senior engineer.", descriptionPending: true }),
            "ready",
        );
    });
});

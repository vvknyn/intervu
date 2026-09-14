import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { descriptionPaneState } from "../../src/lib/jobs/for-you/description-pane-state";
import { splitPackSections } from "../../src/lib/jobs/for-you/pack-sections";

/**
 * Defect (live QA): ForYouPack flashed "No description available for this
 * role" for a job that HAS a description, because pendingness was inferred
 * from `displayJob.description === undefined` instead of the pending flag —
 * a fetch resolving to a transient empty string while still in flight fell
 * straight through to the empty state. Fixed by deciding pane state from
 * `descriptionPending` alone.
 */
describe("descriptionPaneState", () => {
    it("shows loading while pending, even though the not-yet-arrived description is an empty string (the surfaced bug)", () => {
        const sections = splitPackSections("");
        assert.equal(descriptionPaneState(true, sections), "loading");
    });

    it("shows loading while pending for any other falsy description shape (class-wide, not just empty string)", () => {
        assert.equal(descriptionPaneState(true, splitPackSections(null)), "loading");
        assert.equal(descriptionPaneState(true, splitPackSections(undefined)), "loading");
    });

    it("shows empty once genuinely finished with nothing to show, never fabricating content", () => {
        const sections = splitPackSections("");
        assert.equal(descriptionPaneState(false, sections), "empty");
    });

    it("shows content once genuinely finished with real sections", () => {
        const sections = splitPackSections("About the role:\n\nWe build tools.");
        assert.equal(descriptionPaneState(false, sections), "content");
    });
});

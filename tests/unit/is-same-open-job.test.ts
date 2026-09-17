import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isSameOpenJob } from "../../src/lib/jobs/is-same-open-job";

describe("isSameOpenJob", () => {
    it("is true for a re-click on the job that's already open", () => {
        assert.equal(isSameOpenJob("job-1", "job-1", true), true);
    });

    it("is false when the panel is closed, even for a matching id", () => {
        // Motivating case: a manually-dismissed sheet leaves `currentId`
        // naming the last-open job while nothing is showing — a re-click on
        // that row must reopen it, not no-op.
        assert.equal(isSameOpenJob("job-1", "job-1", false), false);
    });

    it("is false for a click on a different job while the panel is open", () => {
        assert.equal(isSameOpenJob("job-1", "job-2", true), false);
    });

    it("is false when nothing is currently open (currentId null)", () => {
        assert.equal(isSameOpenJob(null, "job-1", true), false);
    });
});

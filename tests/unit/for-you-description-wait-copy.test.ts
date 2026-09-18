import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    DESCRIPTION_FAILURE_COPY,
    DESCRIPTION_STALL_COPY,
    DESCRIPTION_STALL_COPY_MS,
    DESCRIPTION_START_COPY,
    DESCRIPTION_WAIT_COPY,
    DESCRIPTION_WAIT_COPY_MS,
    descriptionWaitCopy,
    descriptionWaitPhase,
} from "../../src/lib/jobs/for-you/description-wait-copy";

const FAILURE_AFTER_MS = 12_000; // DETAIL_FETCH_TIMEOUT_MS, passed by the caller

describe("descriptionWaitPhase", () => {
    it("is 'start' at t=0 — nothing extra beyond the spinner yet", () => {
        assert.equal(descriptionWaitPhase(0, FAILURE_AFTER_MS), "start");
    });

    it("stays 'start' just before the 1500ms threshold", () => {
        assert.equal(descriptionWaitPhase(DESCRIPTION_WAIT_COPY_MS - 1, FAILURE_AFTER_MS), "start");
    });

    it("is 'wait' at exactly 1500ms and beyond, up to the stall threshold", () => {
        assert.equal(descriptionWaitPhase(DESCRIPTION_WAIT_COPY_MS, FAILURE_AFTER_MS), "wait");
        assert.equal(descriptionWaitPhase(DESCRIPTION_STALL_COPY_MS - 1, FAILURE_AFTER_MS), "wait");
    });

    it("is 'stall' at exactly 6000ms and beyond, up to the failure deadline", () => {
        assert.equal(descriptionWaitPhase(DESCRIPTION_STALL_COPY_MS, FAILURE_AFTER_MS), "stall");
        assert.equal(descriptionWaitPhase(FAILURE_AFTER_MS - 1, FAILURE_AFTER_MS), "stall");
    });

    it("is 'failed' once elapsed reaches the caller's failure deadline", () => {
        assert.equal(descriptionWaitPhase(FAILURE_AFTER_MS, FAILURE_AFTER_MS), "failed");
        assert.equal(descriptionWaitPhase(FAILURE_AFTER_MS + 5_000, FAILURE_AFTER_MS), "failed");
    });

    it("honors a different caller-supplied failure deadline — not hardcoded to 12s", () => {
        assert.equal(descriptionWaitPhase(8_000, 8_000), "failed");
        assert.equal(descriptionWaitPhase(7_999, 8_000), "stall");
    });
});

describe("descriptionWaitCopy", () => {
    it("returns the exact strings for each phase, no alterations", () => {
        assert.equal(descriptionWaitCopy("start"), DESCRIPTION_START_COPY);
        assert.equal(descriptionWaitCopy("wait"), DESCRIPTION_WAIT_COPY);
        assert.equal(descriptionWaitCopy("stall"), DESCRIPTION_STALL_COPY);
        assert.equal(descriptionWaitCopy("failed"), DESCRIPTION_FAILURE_COPY);
    });

    it("pins the brief's exact copy text", () => {
        assert.equal(DESCRIPTION_WAIT_COPY, "Fetching the full posting from the employer…");
        assert.equal(
            DESCRIPTION_STALL_COPY,
            "Still working. The employer's site is slow — you can skip and come back.",
        );
        assert.equal(DESCRIPTION_FAILURE_COPY, "Couldn't load the full posting right now.");
    });
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    isRetryableMeiliFailure,
    isPostedTsPopulationSufficient,
    POSTED_TS_POPULATION_THRESHOLD,
} from "../../src/lib/jobs/meilisearch";

// Phase 1-a #1: retry-policy decision — 5xx (transient) is retryable, 4xx
// (the request itself is wrong) never is.
test("isRetryableMeiliFailure: 5xx is retryable, 4xx and 2xx are not", () => {
    assert.equal(isRetryableMeiliFailure(500), true);
    assert.equal(isRetryableMeiliFailure(503), true);
    assert.equal(isRetryableMeiliFailure(400), false);
    assert.equal(isRetryableMeiliFailure(404), false);
    assert.equal(isRetryableMeiliFailure(429), false);
    assert.equal(isRetryableMeiliFailure(200), false);
});

// Phase 1-a #4: population-threshold decision — config presence (the field
// being filterable) lies; a bare > 0 headcount also lies on a near-empty
// partial backfill. Only a meaningful population passes.
test("isPostedTsPopulationSufficient requires both a nonzero count and a real fraction of the corpus", () => {
    assert.equal(isPostedTsPopulationSufficient(0, 1_000_000), false, "zero population never supported");
    assert.equal(isPostedTsPopulationSufficient(1, 1_000_000), false, "a token handful isn't real population");
    assert.equal(isPostedTsPopulationSufficient(500_000, 1_000_000), true, "half the corpus is clearly enough");
});

test("isPostedTsPopulationSufficient sits right at the documented threshold", () => {
    const total = 1_000_000;
    const atThreshold = Math.floor(total * POSTED_TS_POPULATION_THRESHOLD);
    const aboveThreshold = atThreshold + 1_000;
    assert.equal(isPostedTsPopulationSufficient(atThreshold, total), false, "exactly at the bar doesn't clear it");
    assert.equal(isPostedTsPopulationSufficient(aboveThreshold, total), true);
});

test("isPostedTsPopulationSufficient treats an empty/unknown corpus as unsupported", () => {
    assert.equal(isPostedTsPopulationSufficient(0, 0), false);
    assert.equal(isPostedTsPopulationSufficient(5, 0), false);
});

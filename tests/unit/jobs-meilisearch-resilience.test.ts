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

// Jul 24 incident: the probe answering "no" on its OWN failure made the app
// drop the default 30d posted filter and send match-all+facets browse queries
// exactly when the box was degraded. Probe failure must be "unknown" (null),
// never "unsupported" (false) — only a successful measurement may demote.
test("fetchPostedDateFilterSupported: probe failure is null (unknown), success measures population", async (t) => {
    process.env.MEILISEARCH_HOST = "https://meili.test";
    process.env.MEILISEARCH_SEARCH_KEY = "k";
    const { fetchPostedDateFilterSupported } = await import("../../src/lib/jobs/meilisearch");

    t.mock.method(globalThis, "fetch", async () => {
        throw new Error("ECONNRESET");
    });
    assert.equal(await fetchPostedDateFilterSupported(), null, "network failure → unknown");

    let call = 0;
    t.mock.method(globalThis, "fetch", async () => ({
        ok: true,
        json: async () => ({ totalHits: call++ === 0 ? 1_000_000 : 900_000 }),
    }));
    assert.equal(await fetchPostedDateFilterSupported(), true, "measured sufficient → supported");

    let call2 = 0;
    t.mock.method(globalThis, "fetch", async () => ({
        ok: true,
        json: async () => ({ totalHits: call2++ === 0 ? 1_000_000 : 0 }),
    }));
    assert.equal(await fetchPostedDateFilterSupported(), false, "measured zero population → unsupported");
});

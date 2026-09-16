import { test } from "node:test";
import assert from "node:assert/strict";
import {
    normalizePublicJob,
    normalizePublicJobs,
    resolvePublicJobApplyUrl,
    resolvePublicJobLocation,
} from "../../src/lib/jobs/normalize-public-job";
import type { PublicJob } from "../../src/lib/jobs/types";

test("resolvePublicJobApplyUrl prefers apply_url, then url, then empty string", () => {
    assert.equal(resolvePublicJobApplyUrl({ apply_url: "https://a.test/apply" }), "https://a.test/apply");
    assert.equal(resolvePublicJobApplyUrl({ url: "https://a.test/posting" }), "https://a.test/posting");
    assert.equal(resolvePublicJobApplyUrl({ apply_url: "https://a.test/apply", url: "https://a.test/posting" }), "https://a.test/apply");
    assert.equal(resolvePublicJobApplyUrl({}), "");
});

test("resolvePublicJobLocation returns null when no location signal exists", () => {
    assert.equal(resolvePublicJobLocation({ location: null, location_city: null, location_state: null, location_country: null }), null);
});

test("resolvePublicJobLocation composes city, state, and country", () => {
    assert.equal(
        resolvePublicJobLocation({
            location: null,
            location_city: "Toronto",
            location_state: "ON",
            location_country: "Canada",
        }),
        "Toronto, ON, Canada",
    );
});

test("normalizePublicJobs normalizes every hit in a batch", () => {
    const hits = normalizePublicJobs([
        { id: "1", title: "A", company: "Co", url: "https://a.test/1" } as PublicJob & { url: string },
        { id: "2", title: "B", company: "Co", apply_url: "https://a.test/2" } as PublicJob,
    ]);
    assert.equal(hits[0].apply_url, "https://a.test/1");
    assert.equal(hits[0].location, null);
    assert.equal(hits[1].apply_url, "https://a.test/2");
});

test("normalizePublicJob never leaves apply_url or location undefined", () => {
    const job = normalizePublicJob({
        id: "j1",
        title: "Eng",
        company: "Acme",
    } as PublicJob);
    assert.equal(job.apply_url, "");
    assert.equal(job.location, null);
    assert.equal("apply_url" in job, true);
    assert.equal("location" in job, true);
});

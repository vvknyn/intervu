import { test } from "node:test";
import assert from "node:assert/strict";
import { planProbes } from "../../src/lib/jobs/run-search";

// Perf first-paint (2026-09-18): `runJobsSearch` folds the two client-fired
// probes (ghost-hidden count, beyond-default-window count) into the main search
// response, computed server-side in parallel. `planProbes` is the pure
// decision for WHICH probes run — it must mirror exactly what page.tsx's
// deleted client probes used to gate themselves on, so these cases are keyed
// to that old gating, not to any one caller's params shape. The window the
// beyond-window probe keys on is the default one (`DEFAULT_URL_STATE`,
// "90d" since 2026-09-30; "30d" when the probes moved server-side).

test("neither hideGhosts nor the default 90d bucket — no probes run", () => {
    assert.deepEqual(planProbes({ hideGhosts: false, postedBucket: undefined }), {
        ghost: false,
        beyondWindow: false,
    });
});

test("hideGhosts true, postedBucket 90d — both probes run (the getDefaultBrowseAction / pristine-landing shape)", () => {
    assert.deepEqual(planProbes({ hideGhosts: true, postedBucket: "90d" }), {
        ghost: true,
        beyondWindow: true,
    });
});

test("hideGhosts true alone (a non-default bucket) — only the ghost probe runs", () => {
    assert.deepEqual(planProbes({ hideGhosts: true, postedBucket: "7d" }), {
        ghost: true,
        beyondWindow: false,
    });
    assert.deepEqual(planProbes({ hideGhosts: true, postedBucket: undefined }), {
        ghost: true,
        beyondWindow: false,
    });
});

test("postedBucket 90d alone (ghosts shown) — only the beyond-window probe runs", () => {
    assert.deepEqual(planProbes({ hideGhosts: false, postedBucket: "90d" }), {
        ghost: false,
        beyondWindow: true,
    });
});

test("postedBucket must be exactly the default \"90d\" — any other bucket (including the old 30d default and a truthy string) leaves the affordance off", () => {
    assert.equal(planProbes({ hideGhosts: false, postedBucket: "7d" }).beyondWindow, false);
    assert.equal(planProbes({ hideGhosts: false, postedBucket: "30d" }).beyondWindow, false);
    assert.equal(planProbes({ hideGhosts: false, postedBucket: "any" as never }).beyondWindow, false);
});

// A case distinct from the motivating instance (getDefaultBrowseAction's own
// probeBasis, which is a full JobSearchParams object with `places`/`sort`/etc
// alongside hideGhosts/postedBucket): planProbes only reads the two fields it
// declares, so a minimal object carrying nothing else still decides correctly
// — proving the decision is keyed to those two fields alone, not to a richer
// shape only one caller happens to pass.
test("reads only hideGhosts/postedBucket off whatever basis it's given — extra fields on a richer params object don't change the plan", () => {
    const richBasis = {
        hideGhosts: true,
        postedBucket: "90d" as const,
        sort: "newest" as const,
        limit: 24,
        offset: 0,
        withFacets: true,
        places: [{ city: "Austin", state: "TX" }],
    };
    assert.deepEqual(planProbes(richBasis), { ghost: true, beyondWindow: true });
});

test("a later page (offset > 0) runs no probes: load-more never reads them", () => {
    assert.deepEqual(planProbes({ hideGhosts: true, postedBucket: "30d", offset: 20 }), {
        ghost: false,
        beyondWindow: false,
    });
    assert.deepEqual(planProbes({ hideGhosts: true, postedBucket: "30d", offset: 0 }), {
        ghost: true,
        beyondWindow: true,
    });
});

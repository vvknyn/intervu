import test from "node:test";
import assert from "node:assert/strict";
import {
    cookieHeaderHasJobsSignedInPaintHint,
    shouldTouchJobsSignedInPaintCookie,
} from "../../src/lib/jobs/signed-in-paint-cookie";

test("signed-in paint cookie is touched only on GET /jobs", () => {
    assert.equal(shouldTouchJobsSignedInPaintCookie({ method: "GET", pathname: "/jobs" }), true);
    assert.equal(shouldTouchJobsSignedInPaintCookie({ method: "POST", pathname: "/jobs" }), false);
    assert.equal(shouldTouchJobsSignedInPaintCookie({ method: "GET", pathname: "/jobs/some-slug" }), false);
    assert.equal(shouldTouchJobsSignedInPaintCookie({ method: "GET", pathname: "/" }), false);
});

test("paint hint matches only the exact cookie pair", () => {
    assert.equal(cookieHeaderHasJobsSignedInPaintHint("velai_jobs_signed_in=1"), true);
    assert.equal(cookieHeaderHasJobsSignedInPaintHint("sb_jobs_visitor=1; velai_jobs_signed_in=1"), true);
    assert.equal(cookieHeaderHasJobsSignedInPaintHint("velai_jobs_signed_in=0"), false);
    assert.equal(cookieHeaderHasJobsSignedInPaintHint("other=velai_jobs_signed_in=1"), false);
    assert.equal(cookieHeaderHasJobsSignedInPaintHint(""), false);
});

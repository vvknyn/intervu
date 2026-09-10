import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldStampJobsVisitor } from "../../src/lib/jobs-visitor-cookie";

/**
 * A Set-Cookie on a server-action POST makes Next report
 * `x-action-revalidated`, which makes the client router refresh the whole
 * route after every action (see jobs-visitor-cookie.ts doc comment). This
 * cookie must be stamped only on document/RSC GET navigations under /jobs,
 * never on the POSTs server actions make to that same route or its slugs.
 */

test("GET /jobs stamps", () => {
    assert.equal(shouldStampJobsVisitor({ method: "GET", pathname: "/jobs" }), true);
});

test("GET /jobs with a query string is the same pathname — still stamps", () => {
    assert.equal(shouldStampJobsVisitor({ method: "GET", pathname: "/jobs" }), true);
});

test("POST /jobs (server action on the search page) does not stamp", () => {
    assert.equal(shouldStampJobsVisitor({ method: "POST", pathname: "/jobs" }), false);
});

test("POST /jobs/some-slug (server action on the SSR job page) does not stamp", () => {
    assert.equal(shouldStampJobsVisitor({ method: "POST", pathname: "/jobs/some-slug" }), false);
});

test("GET /co/x (a different route) does not stamp", () => {
    assert.equal(shouldStampJobsVisitor({ method: "GET", pathname: "/co/x" }), false);
});

test("HEAD /jobs does not stamp", () => {
    assert.equal(shouldStampJobsVisitor({ method: "HEAD", pathname: "/jobs" }), false);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    authGateReasonToFunnelReason,
    buildPostAuthResumeGatePath,
    hasPostAuthResumeGateParam,
    isBareJobsDefault,
    resolvePostAuthDestination,
} from "../../src/lib/auth/post-auth-destination";

test("buildPostAuthResumeGatePath returns the /jobs gate query", () => {
    assert.equal(buildPostAuthResumeGatePath(), "/jobs?resume=gate");
    assert.equal(hasPostAuthResumeGateParam("/jobs?resume=gate"), true);
    assert.equal(hasPostAuthResumeGateParam("/jobs"), false);
});

test("isBareJobsDefault treats bare /jobs and the gate URL as anonymous defaults", () => {
    assert.equal(isBareJobsDefault(null), true);
    assert.equal(isBareJobsDefault("/jobs"), true);
    assert.equal(isBareJobsDefault("/jobs?resume=gate"), true);
    assert.equal(isBareJobsDefault("/jobs?q=engineer"), false);
    assert.equal(isBareJobsDefault("/settings"), false);
});

test("resolvePostAuthDestination keeps returnTo when user has a résumé", () => {
    assert.equal(
        resolvePostAuthDestination({
            validatedNext: "/jobs?q=design",
            hasResume: true,
            hasPendingAction: false,
        }),
        "/jobs?q=design",
    );
    assert.equal(
        resolvePostAuthDestination({
            validatedNext: null,
            hasResume: true,
            hasPendingAction: false,
        }),
        "/jobs",
    );
});

test("resolvePostAuthDestination honors pending actions without forcing the gate URL", () => {
    assert.equal(
        resolvePostAuthDestination({
            validatedNext: "/jobs",
            hasResume: false,
            hasPendingAction: true,
        }),
        "/jobs",
    );
});

test("resolvePostAuthDestination routes résumeless default sign-ins to the gate path", () => {
    assert.equal(
        resolvePostAuthDestination({
            validatedNext: null,
            hasResume: false,
            hasPendingAction: false,
        }),
        "/jobs?resume=gate",
    );
    assert.equal(
        resolvePostAuthDestination({
            validatedNext: "/jobs",
            hasResume: false,
            hasPendingAction: false,
        }),
        "/jobs?resume=gate",
    );
});

test("resolvePostAuthDestination keeps explicit non-default destinations", () => {
    assert.equal(
        resolvePostAuthDestination({
            validatedNext: "/connect?client=claude",
            hasResume: false,
            hasPendingAction: false,
        }),
        "/connect?client=claude",
    );
    assert.equal(
        resolvePostAuthDestination({
            validatedNext: "/jobs?q=engineer",
            hasResume: false,
            hasPendingAction: false,
        }),
        "/jobs?q=engineer",
    );
});

test("authGateReasonToFunnelReason maps gate continuity to funnel reasons", () => {
    assert.equal(authGateReasonToFunnelReason("fit"), "fit");
    assert.equal(authGateReasonToFunnelReason("resume"), "resume");
    assert.equal(authGateReasonToFunnelReason("apply"), "tracker");
    assert.equal(authGateReasonToFunnelReason("topbar"), "fit");
    assert.equal(authGateReasonToFunnelReason(undefined), "fit");
});

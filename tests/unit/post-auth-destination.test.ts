import { test } from "node:test";
import assert from "node:assert/strict";
import {
    authGateReasonToFunnelReason,
    buildPostAuthResumeGatePath,
    hasPostAuthResumeGateParam,
    isBareJobsDefault,
    resolveAuthKitReturnTo,
    resolvePostAuthDestination,
    shouldOpenResumeGateAfterInlineAuth,
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
    assert.equal(
        resolvePostAuthDestination({
            validatedNext: "/co/acme",
            hasResume: false,
            hasPendingAction: true,
        }),
        "/co/acme",
    );
});

test("resolvePostAuthDestination routes every résumeless no-pending landing to the gate", () => {
    const gate = "/jobs?resume=gate";
    for (const validatedNext of [
        null,
        "/jobs",
        "/jobs?q=engineer",
        "/co/outerboxdesign--com",
        "/connect?client=claude",
        "/settings",
    ]) {
        assert.equal(
            resolvePostAuthDestination({
                validatedNext,
                hasResume: false,
                hasPendingAction: false,
            }),
            gate,
        );
    }
});

test("authGateReasonToFunnelReason maps gate continuity to funnel reasons", () => {
    assert.equal(authGateReasonToFunnelReason("fit"), "fit");
    assert.equal(authGateReasonToFunnelReason("resume"), "resume");
    assert.equal(authGateReasonToFunnelReason("apply"), "tracker");
    assert.equal(authGateReasonToFunnelReason("topbar"), "fit");
    assert.equal(authGateReasonToFunnelReason(undefined), "fit");
});

test("resolveAuthKitReturnTo sends every signup returnTo to the gate path", () => {
    const gate = "/jobs?resume=gate";
    for (const rawNext of [
        null,
        "/jobs",
        "/jobs/",
        "/jobs?resume=gate",
        "/jobs?q=engineer",
        "/settings",
        "/co/acme",
        "/co/outerboxdesign--com",
    ]) {
        assert.equal(resolveAuthKitReturnTo({ mode: "signup", rawNext }), gate);
    }
});

test("resolveAuthKitReturnTo does not rewrite sign-in return targets", () => {
    assert.equal(resolveAuthKitReturnTo({ mode: "login", rawNext: "/jobs" }), "/jobs");
    assert.equal(resolveAuthKitReturnTo({ mode: "login", rawNext: "/co/acme" }), "/co/acme");
    assert.equal(resolveAuthKitReturnTo({ mode: "login", rawNext: null }), null);
});

test("shouldOpenResumeGateAfterInlineAuth opens only when clear and résumeless", () => {
    const base = {
        pendingActionKind: null as string | null,
        alreadyHandled: false,
        importAlreadyOpen: false,
        hasResume: false,
    };
    assert.equal(shouldOpenResumeGateAfterInlineAuth(base), true);
    assert.equal(
        shouldOpenResumeGateAfterInlineAuth({ ...base, pendingActionKind: "upload" }),
        false,
    );
    assert.equal(
        shouldOpenResumeGateAfterInlineAuth({ ...base, alreadyHandled: true }),
        false,
    );
    assert.equal(
        shouldOpenResumeGateAfterInlineAuth({ ...base, importAlreadyOpen: true }),
        false,
    );
    assert.equal(
        shouldOpenResumeGateAfterInlineAuth({ ...base, hasResume: true }),
        false,
    );
});

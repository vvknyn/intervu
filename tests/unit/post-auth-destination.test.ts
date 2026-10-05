import { test } from "node:test";
import assert from "node:assert/strict";
import {
    authGateReasonToFunnelReason,
    isBareJobsDefault,
    resolveAuthKitReturnTo,
    resolvePostAuthDestination,
    resumeImporterHref,
    resumeImporterValue,
    signupGateHrefs,
} from "../../src/lib/auth/post-auth-destination";

test("the importer link is /jobs?resume=setup, and the old sign-up value still reads", () => {
    assert.equal(resumeImporterHref(), "/jobs?resume=setup");
    assert.equal(resumeImporterValue("/jobs?resume=setup"), "setup");
    assert.equal(resumeImporterValue("/jobs?resume=gate"), "gate");
    assert.equal(resumeImporterValue("/jobs?q=nurse&resume=gate"), "gate");
    assert.equal(resumeImporterValue("/jobs"), null);
    assert.equal(resumeImporterValue("/jobs?resume=other"), null);
    assert.equal(resumeImporterValue("/co/acme?resume=gate"), null);
});

test("isBareJobsDefault treats bare /jobs and the importer links as anonymous defaults", () => {
    assert.equal(isBareJobsDefault(null), true);
    assert.equal(isBareJobsDefault("/jobs"), true);
    assert.equal(isBareJobsDefault("/jobs?resume=gate"), true);
    assert.equal(isBareJobsDefault("/jobs?q=engineer"), false);
    assert.equal(isBareJobsDefault("/settings"), false);
});

test("every sign-in and sign-up comes back to the page it started on, résumé or not", () => {
    const pages = [
        "/co/acme",
        "/jobs?q=nurse&country=Canada",
        "/jobs/backend-engineer-acme-1",
        "/jobs?job=abc",
        "/settings",
        "/connect",
        "/oauth/authorize?client_id=abc&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb&code_challenge=x&code_challenge_method=S256&response_type=code",
    ];
    for (const next of pages) {
        assert.equal(resolvePostAuthDestination(next), next);
        assert.equal(resolveAuthKitReturnTo(next), next);
        assert.equal(resolveAuthKitReturnTo(`  ${next} `), next);
    }
});

test("nowhere to return to lands on /jobs, never on the résumé importer", () => {
    assert.equal(resolvePostAuthDestination(null), "/jobs");
    assert.equal(resolvePostAuthDestination("/jobs"), "/jobs");
    // An old sign-up link that still carries the importer flag.
    assert.equal(resolvePostAuthDestination("/jobs?resume=gate"), "/jobs");
    assert.equal(resolveAuthKitReturnTo("/jobs?resume=gate"), "/jobs");
    assert.equal(resolveAuthKitReturnTo(null), null);
    assert.equal(resolveAuthKitReturnTo("   "), null);
});

test("a sign-in card's doors both carry the page it sits on", () => {
    assert.deepEqual(signupGateHrefs("/co/acme"), {
        create: "/auth/start?mode=signup&next=%2Fco%2Facme",
        signIn: "/login?next=%2Fco%2Facme",
    });
});

test("authGateReasonToFunnelReason maps gate continuity to funnel reasons", () => {
    assert.equal(authGateReasonToFunnelReason("fit"), "fit");
    assert.equal(authGateReasonToFunnelReason("resume"), "resume");
    assert.equal(authGateReasonToFunnelReason("apply"), "tracker");
    assert.equal(authGateReasonToFunnelReason("topbar"), "fit");
    assert.equal(authGateReasonToFunnelReason(undefined), "fit");
});

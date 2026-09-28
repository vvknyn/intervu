import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAuthChrome } from "../../src/lib/auth/chrome-state";
import {
    isConfirmedSignedIn,
    isConfirmedSignedOut,
    resolveJobsResumeOnFile,
    shouldShowJobsHomeViewToggle,
} from "../../src/lib/auth/jobs-chrome-gates";
import { readFileSync } from "node:fs";

test("undefined is pending, not anonymous — the whole point", () => {
    // If this ever returns "anonymous", signed-in users get a Sign-in button
    // flashed at them during the server round-trip.
    assert.equal(resolveAuthChrome(undefined), "pending");
});

test("null is anonymous — a resolved answer of nobody", () => {
    assert.equal(resolveAuthChrome(null), "anonymous");
});

test("any user object is authenticated, whatever its shape", () => {
    // Deliberately not tied to one provider's user shape: Firebase and WorkOS
    // return different objects and the chrome must not care which it got.
    assert.equal(resolveAuthChrome({ email: "a@b.c" }), "authenticated");
    assert.equal(resolveAuthChrome({ id: "user_123", firstName: "Ada" }), "authenticated");
    assert.equal(resolveAuthChrome({}), "authenticated");
});

test("the three states are exhaustive and mutually exclusive", () => {
    const seen = new Set(
        [undefined, null, { email: "x@y.z" }].map((u) => resolveAuthChrome(u)),
    );
    assert.deepEqual([...seen].sort(), ["anonymous", "authenticated", "pending"]);
});

test("confirmed signed-in requires authReady and a user object", () => {
    assert.equal(isConfirmedSignedIn(false, { uid: "u1" }), false);
    assert.equal(isConfirmedSignedIn(true, null), false);
    assert.equal(isConfirmedSignedIn(true, { uid: "u1" }), true);
});

test("confirmed signed-out requires authReady and no user", () => {
    assert.equal(isConfirmedSignedOut(false, null), false);
    assert.equal(isConfirmedSignedOut(true, { uid: "u1" }), false);
    assert.equal(isConfirmedSignedOut(true, null), true);
});

test("stale in-memory résumé does not count as on file after sign-out", () => {
    assert.equal(
        resolveJobsResumeOnFile({
            authReady: true,
            signedIn: false,
            hasUsableResume: true,
            localAiGuestEnabled: false,
            resumeKnownOnServer: true,
        }),
        false,
    );
});

test("local-AI guest résumé still unlocks For you when signed out", () => {
    assert.equal(
        resolveJobsResumeOnFile({
            authReady: true,
            signedIn: false,
            hasUsableResume: true,
            localAiGuestEnabled: true,
            resumeKnownOnServer: false,
        }),
        true,
    );
});

test("For-you toggle never renders for a confirmed signed-out session", () => {
    assert.equal(
        shouldShowJobsHomeViewToggle({
            signedOut: true,
            signedIn: false,
            resumeOnFile: true,
            showJobsHomePending: true,
        }),
        false,
    );
});

test("For-you toggle shows for every confirmed signed-in session", () => {
    assert.equal(
        shouldShowJobsHomeViewToggle({
            signedOut: false,
            signedIn: true,
            resumeOnFile: true,
            showJobsHomePending: false,
        }),
        true,
    );
    assert.equal(
        shouldShowJobsHomeViewToggle({
            signedOut: false,
            signedIn: true,
            resumeOnFile: false,
            showJobsHomePending: false,
        }),
        true,
    );
    assert.equal(
        shouldShowJobsHomeViewToggle({
            signedOut: false,
            signedIn: false,
            resumeOnFile: null,
            showJobsHomePending: true,
        }),
        false,
    );
});

test("clearSessionClientStores wires every session-tied cache invalidator", () => {
    const src = readFileSync(new URL("../../src/lib/auth/session-client-stores.ts", import.meta.url), "utf8");
    assert.match(src, /invalidateSavedSearchesCache/);
    assert.match(src, /invalidateFollowsCache/);
    assert.match(src, /invalidatePursuitsCache/);
    assert.match(src, /clearSavedSearches/);
    assert.match(src, /clearLocalAiResume/);
    assert.doesNotMatch(src, /writeLocalAiEnabled\(false\)/);
});

test("signOut bumps epoch, clears client stores, and notifies listeners", () => {
    const src = readFileSync(new URL("../../src/lib/firebase/client-auth.ts", import.meta.url), "utf8");
    assert.match(src, /sessionEpoch \+= 1/);
    assert.match(src, /abortInflightSessionFetch/);
    assert.match(src, /clearSessionClientStores/);
    assert.match(src, /commitSessionUser\(signOutEpoch, null\)/);
    assert.match(src, /isCurrentSessionEpoch/);
    assert.match(src, /pageshow/);
    assert.match(src, /isSignedOutMarkerSet\(\)\) \{[\s\S]*sessionEpoch \+= 1[\s\S]*abortInflightSessionFetch/);
    assert.match(src, /revalidateClientSession/);
    assert.match(src, /applyingSignOut && user/);
    assert.match(src, /velai\.auth\.signedOut/);
    assert.match(src, /form\.action = "\/auth\/signout"/);
    assert.match(src, /form\.submit\(\)/);
    assert.doesNotMatch(src, /redirect:\s*"manual"/);
    assert.doesNotMatch(src, /fetch\("\/auth\/signout"/);
    assert.doesNotMatch(
        src,
        /commitSessionUser\(signOutEpoch, null\)[\s\S]*fetchServerUser/,
        "signOut must not resurrection-check the session after committing null",
    );
});

test("jobs page gates For-you chrome on confirmed session and clears stale résumé", () => {
    const src = readFileSync(new URL("../../src/app/jobs/JobsContent.tsx", import.meta.url), "utf8");
    assert.match(src, /shouldShowJobsHomeViewToggle/);
    assert.match(src, /resolveJobsResumeOnFile/);
    assert.match(src, /signedOut[\s\S]*localAiGuestEnabled[\s\S]*setResume\(null\)/);
    assert.match(src, /useSyncExternalStore\([\s\S]*subscribeLocalAiEnabled/);
    assert.match(src, /deepLinkedSession[\s\S]*revalidateClientSession/);
});

test("follow alerts bell requires a confirmed signed-in session", () => {
    const src = readFileSync(new URL("../../src/components/follows/FollowAlertsBell.tsx", import.meta.url), "utf8");
    assert.match(src, /isSignedIn/);
    assert.match(src, /if \(!isSignedIn\) return null/);
});

test("connect tab label ignores server résumé presence when signed out", () => {
    const src = readFileSync(new URL("../../src/components/layout/use-connect-tab-label.ts", import.meta.url), "utf8");
    assert.match(src, /signedIn && resumeOnFile === true/);
});

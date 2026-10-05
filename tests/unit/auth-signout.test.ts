import { describe, it, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    isAuthSignOutRequest,
    isWorkOsLogoutUrl,
    SIGN_OUT_LANDING_PATH,
    signOutBrowserLocation,
    signOutRedirectTarget,
    workOsLogoutSessionId,
} from "../../src/lib/auth/signout-request";

describe("isAuthSignOutRequest", () => {
    it("is true only for POST /auth/signout", () => {
        assert.equal(isAuthSignOutRequest("/auth/signout", "POST"), true);
        assert.equal(isAuthSignOutRequest("/auth/signout", "GET"), false);
        assert.equal(isAuthSignOutRequest("/auth/signout/", "POST"), false);
        assert.equal(isAuthSignOutRequest("/auth/start", "POST"), false);
        assert.equal(isAuthSignOutRequest("/api/auth/session", "POST"), false);
        assert.equal(isAuthSignOutRequest("/auth/signout", "post"), true);
    });
});

describe("workOsLogoutSessionId", () => {
    it("returns session_id for WorkOS logout URLs", () => {
        assert.equal(
            workOsLogoutSessionId("https://api.workos.com/user_management/sessions/logout?session_id=session_1"),
            "session_1",
        );
    });

    it("returns null for relative paths, other hosts, and protocol-relative URLs", () => {
        assert.equal(workOsLogoutSessionId("/"), null);
        assert.equal(workOsLogoutSessionId("https://evil.example/logout?session_id=x"), null);
        assert.equal(workOsLogoutSessionId("//evil.example/logout"), null);
    });
});

describe("isWorkOsLogoutUrl", () => {
    it("also knows the API host this server is pointed at", () => {
        assert.equal(isWorkOsLogoutUrl("http://127.0.0.1:7701/user_management/sessions/logout?session_id=s", "127.0.0.1"), true);
        assert.equal(isWorkOsLogoutUrl("https://auth.example.com/user_management/sessions/logout", "auth.example.com"), true);
    });

    it("refuses every other host, scheme and path", () => {
        assert.equal(isWorkOsLogoutUrl("http://127.0.0.1:7701/user_management/sessions/logout", undefined), false);
        assert.equal(isWorkOsLogoutUrl("http://api.workos.com/user_management/sessions/logout", undefined), false);
        assert.equal(isWorkOsLogoutUrl("https://evil.example/user_management/sessions/logout", "127.0.0.1"), false);
        assert.equal(isWorkOsLogoutUrl("javascript://127.0.0.1/sessions/logout", "127.0.0.1"), false);
        assert.equal(isWorkOsLogoutUrl("http://127.0.0.1:7701/jobs", "127.0.0.1"), false);
    });
});

describe("signOutBrowserLocation", () => {
    it("maps WorkOS logout URLs to /jobs instead of forwarding api.workos.com", () => {
        assert.equal(
            signOutBrowserLocation("https://api.workos.com/user_management/sessions/logout?session_id=session_1"),
            SIGN_OUT_LANDING_PATH,
        );
        assert.equal(
            signOutBrowserLocation("https://api.workos.com/user_management/sessions/logout"),
            SIGN_OUT_LANDING_PATH,
        );
    });

    // "/" only redirects to /jobs, so landing there cost every sign-out a second round trip.
    it("lands on the job board in one hop, never via /", () => {
        assert.equal(SIGN_OUT_LANDING_PATH, "/jobs");
        assert.equal(signOutBrowserLocation("/"), "/jobs");
        assert.equal(signOutBrowserLocation("/jobs"), "/jobs");
    });
});

describe("signOutRedirectTarget", () => {
    it("keeps AuthKit's relative fallback relative", () => {
        assert.deepEqual(signOutRedirectTarget("/jobs"), { status: 303, location: "/jobs", relative: true });
    });

    it("refuses a protocol-relative redirect", () => {
        assert.throws(() => signOutRedirectTarget("//evil.example/logout"));
    });
});

test("middleware skips authkit on the sign-out POST", () => {
    const src = readFileSync(new URL("../../src/middleware.ts", import.meta.url), "utf8");
    const signOutGuard = src.indexOf("isAuthSignOutRequest");
    const authkitCall = src.indexOf("authkit(request)");
    assert.ok(signOutGuard >= 0, "middleware must import isAuthSignOutRequest");
    assert.ok(authkitCall >= 0, "middleware must call authkit");
    assert.ok(signOutGuard < authkitCall, "sign-out guard must run before authkit(request)");
    assert.match(src, /if \(isAuthSignOutRequest\(pathname, request\.method\)\)/);
});

test("signout route 303s to same-origin /jobs and revokes WorkOS after answering", () => {
    const src = readFileSync(new URL("../../src/app/auth/signout/route.ts", import.meta.url), "utf8");
    assert.match(src, /from "@workos-inc\/authkit-nextjs"/);
    assert.match(src, /signOut\(\{ returnTo: SIGN_OUT_LANDING_PATH \}\)/);
    // Awaited, WorkOS's API (retries, 60 s timeout) held every sign-out: 5 s on 2026-09-23.
    assert.match(src, /after\(\(\) => revokeWorkOsSession\(sessionId\)\)/);
    const post = src.slice(src.indexOf("export async function POST"));
    assert.doesNotMatch(post, /await getWorkOS\(\)/, "POST must not wait on WorkOS before answering");
    assert.match(src, /NEXT_REDIRECT;/);
    assert.match(src, /workOsLogoutSessionId/);
    assert.match(src, /revokeSession/);
    assert.match(src, /signOutBrowserLocation/);
    assert.match(src, /signOutRedirectTarget/);
    assert.match(src, /headers: \{ Location: target\.location \}/);
    assert.doesNotMatch(
        src,
        /NextResponse\.redirect\(\s*["']https:\/\/api\.workos\.com/,
        "browser must not be sent to the WorkOS logout URL",
    );
});

test("signOut callers do not navigate after signOut", () => {
    const callers = [
        "../../src/components/layout/TopBar.tsx",
        "../../src/components/settings/SettingsContainer.tsx",
        "../../src/app/stories/page.tsx",
    ];

    for (const rel of callers) {
        const src = readFileSync(new URL(rel, import.meta.url), "utf8");
        const signOutIdx = src.search(/\b(?:firebaseSignOut|signOut)\(/);
        assert.ok(signOutIdx >= 0, `${rel} must call signOut()`);
        const afterSignOut = src.slice(signOutIdx);
        assert.doesNotMatch(
            afterSignOut.slice(0, 400),
            /window\.location\.(href|assign|replace)/,
            `${rel} must not assign window.location after signOut`,
        );
        assert.doesNotMatch(
            afterSignOut.slice(0, 400),
            /router\.push\(/,
            `${rel} must not router.push after signOut`,
        );
    }
});

/**
 * A tab opened before a release asks for lazily loaded files that are gone.
 * Sign-out awaited one before sending its POST (2026-10-05: a ChunkLoadError
 * on the founder's tab right before a slow sign-out), so the POST must go out
 * first and the store clearing must not be able to stop it.
 */
test("the sign-out POST goes out before the lazily loaded store clearing", () => {
    const src = readFileSync(new URL("../../src/lib/firebase/client-auth.ts", import.meta.url), "utf8");
    const fn = src.slice(src.indexOf("export async function signOut()"));
    const submit = fn.indexOf("submitSignOutForm();");
    const awaitStores = fn.indexOf("await stores");
    assert.ok(submit >= 0, "signOut must submit the sign-out form");
    assert.ok(awaitStores >= 0, "signOut must still clear the session stores");
    assert.ok(submit < awaitStores, "the POST must not wait on the store-clearing file");
    assert.doesNotMatch(fn.slice(0, submit), /await /, "nothing may be awaited before the POST");
    assert.match(fn, /try \{\s*\(await stores\)\.clearSessionClientStores\(\);\s*\} catch/);
});

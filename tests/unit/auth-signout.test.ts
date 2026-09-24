import { describe, it, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    isAuthSignOutRequest,
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

describe("signOutBrowserLocation", () => {
    it("maps WorkOS logout URLs to / instead of forwarding api.workos.com", () => {
        assert.equal(
            signOutBrowserLocation("https://api.workos.com/user_management/sessions/logout?session_id=session_1"),
            "/",
        );
        assert.equal(
            signOutBrowserLocation("https://api.workos.com/user_management/sessions/logout"),
            "/",
        );
    });

    it("preserves AuthKit relative fallbacks", () => {
        assert.equal(signOutBrowserLocation("/"), "/");
    });
});

describe("signOutRedirectTarget", () => {
    it("keeps AuthKit's relative fallback relative", () => {
        assert.deepEqual(signOutRedirectTarget("/"), { status: 303, location: "/", relative: true });
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

test("signout route revokes WorkOS server-side and 303s to same-origin /", () => {
    const src = readFileSync(new URL("../../src/app/auth/signout/route.ts", import.meta.url), "utf8");
    assert.match(src, /from "@workos-inc\/authkit-nextjs"/);
    assert.match(src, /signOut\(\)/);
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

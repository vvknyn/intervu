import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { sealData } from "iron-session";
import {
    emailCodeCookieOptions,
    emailCodeRestartHref,
    EMAIL_CODE_TTL_SECONDS,
    normalizeEmailCode,
    pendingEmailCodeFromError,
    sealPendingEmailCode,
    unsealPendingEmailCode,
} from "../../src/lib/auth/email-code-pending";
import { returnPathFromAuthState } from "../../src/lib/auth/authkit-state";
import { EMAIL_CODE_EXPIRED_HEADLINE, EMAIL_CODE_HEADLINE, emailCodeBody } from "../../src/lib/auth/email-code-copy";
import { EmailCodeClient } from "../../src/app/auth/verify-email/email-code-client";

/**
 * What this protects: a Google sign-in WorkOS holds for an emailed code
 * (`email_verification_required`) reaching the code step with its pending
 * token and its way back to the job, instead of "We couldn't finish signing
 * you in" (2026-10-04 replay: Apply on a Clinical Dietitian role, phone).
 */

process.env.WORKOS_COOKIE_PASSWORD = "test-cookie-password-at-least-32-characters-long";
process.env.NEXT_PUBLIC_SITE_URL = "https://velai.app";

/** The shape @workos-inc/node's AuthenticationException takes for this code (factory-*.mjs). */
function workosHold(overrides: Record<string, unknown> = {}) {
    return Object.assign(new Error("Email ownership must be verified before authentication."), {
        name: "AuthenticationException",
        status: 403,
        code: "email_verification_required",
        pendingAuthenticationToken: "pat_123",
        rawData: { code: "email_verification_required", email: "dietitian@example.com", pending_authentication_token: "pat_123" },
        ...overrides,
    });
}

describe("pendingEmailCodeFromError", () => {
    it("reads the pending token and address off a WorkOS hold", () => {
        assert.deepEqual(pendingEmailCodeFromError(workosHold()), {
            pendingAuthenticationToken: "pat_123",
            email: "dietitian@example.com",
        });
    });

    it("keeps the hold when WorkOS sends no address", () => {
        assert.deepEqual(pendingEmailCodeFromError(workosHold({ rawData: {} })), {
            pendingAuthenticationToken: "pat_123",
            email: null,
        });
    });

    it("ignores every other failure, and a hold with no token", () => {
        assert.equal(pendingEmailCodeFromError(workosHold({ code: "mfa_challenge" })), null);
        assert.equal(pendingEmailCodeFromError(Object.assign(new Error("x"), { code: "missing_pkce_cookie" })), null);
        assert.equal(pendingEmailCodeFromError(workosHold({ pendingAuthenticationToken: undefined })), null);
        assert.equal(pendingEmailCodeFromError(workosHold({ pendingAuthenticationToken: "" })), null);
        assert.equal(pendingEmailCodeFromError(null), null);
        assert.equal(pendingEmailCodeFromError("email_verification_required"), null);
    });
});

describe("normalizeEmailCode", () => {
    it("accepts six digits typed or pasted with spaces or a dash", () => {
        assert.equal(normalizeEmailCode("123456"), "123456");
        assert.equal(normalizeEmailCode(" 123 456 "), "123456");
        assert.equal(normalizeEmailCode("123-456"), "123456");
    });

    it("refuses anything that isn't six digits", () => {
        for (const raw of ["12345", "1234567", "12a456", "", null, undefined, 123456]) {
            assert.equal(normalizeEmailCode(raw), null, String(raw));
        }
    });
});

describe("the sealed hold", () => {
    it("round-trips token, address and return path", async () => {
        const sealed = await sealPendingEmailCode({
            pendingAuthenticationToken: "pat_123",
            email: "dietitian@example.com",
            next: "/jobs?company=diaverum.com&job=be51670d",
        });
        assert.ok(!sealed.includes("pat_123"), "the token must not be readable in the cookie");
        assert.deepEqual(await unsealPendingEmailCode(sealed), {
            pendingAuthenticationToken: "pat_123",
            email: "dietitian@example.com",
            next: "/jobs?company=diaverum.com&job=be51670d",
        });
    });

    it("is null when missing, tampered with or sealed with another secret", async () => {
        const sealed = await sealPendingEmailCode({ pendingAuthenticationToken: "pat_123", email: null, next: null });
        assert.equal(await unsealPendingEmailCode(undefined), null);
        assert.equal(await unsealPendingEmailCode(""), null);
        assert.equal(await unsealPendingEmailCode(`${sealed.slice(0, -4)}AAAA`), null);
        const foreign = await sealData(
            { pendingAuthenticationToken: "pat_123" },
            { password: "another-secret-that-is-also-32-characters-long" },
        );
        assert.equal(await unsealPendingEmailCode(foreign), null);
    });

    it("never hands back an open-redirect return path", async () => {
        const sealed = await sealPendingEmailCode({ pendingAuthenticationToken: "pat_123", email: null, next: "//evil.example.com" });
        assert.equal((await unsealPendingEmailCode(sealed))?.next, null);
    });

    it("lives as long as WorkOS's own hold, httpOnly and scoped to /auth", () => {
        const options = emailCodeCookieOptions();
        assert.equal(EMAIL_CODE_TTL_SECONDS, 600);
        assert.equal(options.maxAge, 600);
        assert.equal(options.httpOnly, true);
        assert.equal(options.path, "/auth");
    });
});

describe("returnPathFromAuthState", () => {
    it("reads the return path AuthKit sealed into state", async () => {
        const state = await sealData(
            { nonce: "n", codeVerifier: "v", returnPathname: "/jobs?company=diaverum.com&job=be51670d" },
            { password: process.env.WORKOS_COOKIE_PASSWORD!, ttl: 600 },
        );
        assert.equal(await returnPathFromAuthState(state), "/jobs?company=diaverum.com&job=be51670d");
    });

    it("is null for no state, a forged state, or an off-site path", async () => {
        assert.equal(await returnPathFromAuthState(null), null);
        assert.equal(await returnPathFromAuthState("not-a-seal"), null);
        const offSite = await sealData(
            { nonce: "n", codeVerifier: "v", returnPathname: "https://evil.example.com" },
            { password: process.env.WORKOS_COOKIE_PASSWORD!, ttl: 600 },
        );
        assert.equal(await returnPathFromAuthState(offSite), null);
    });
});

describe("emailCodeRestartHref", () => {
    it("restarts Continue with Google back to the same place", () => {
        const url = new URL(emailCodeRestartHref("/jobs?job=abc"), "https://velai.app");
        assert.equal(url.pathname, "/auth/start");
        assert.equal(url.searchParams.get("provider"), "GoogleOAuth");
        assert.equal(url.searchParams.get("next"), "/jobs?job=abc");
    });

    it("drops a missing or unsafe return path", () => {
        assert.equal(emailCodeRestartHref(null), "/auth/start?provider=GoogleOAuth");
        assert.equal(emailCodeRestartHref("//evil.example.com"), "/auth/start?provider=GoogleOAuth");
    });
});

describe("/auth/verify-email renders", () => {
    const restartHref = emailCodeRestartHref("/jobs?job=abc");
    const render = (props: Parameters<typeof EmailCodeClient>[0]) =>
        renderToStaticMarkup(React.createElement(EmailCodeClient, props));

    it("asks for the code, naming the inbox, with a way to get a new one", () => {
        const html = render({ email: "dietitian@example.com", held: true, restartHref });
        assert.ok(html.includes(EMAIL_CODE_HEADLINE));
        assert.ok(html.includes(emailCodeBody("dietitian@example.com")));
        assert.match(html, /autoComplete="one-time-code"|autocomplete="one-time-code"/);
        assert.ok(html.includes(`href="${restartHref.replace(/&/g, "&amp;")}"`));
    });

    it("offers Start again when nothing is held", () => {
        const html = render({ email: null, held: false, restartHref });
        assert.ok(html.includes(EMAIL_CODE_EXPIRED_HEADLINE));
        assert.ok(!html.includes('name="code"'));
    });
});

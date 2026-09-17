import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAuthKitMethod } from "../../src/components/auth/login-form";

test("resolveAuthKitMethod: Google OAuth maps to 'google'", () => {
    assert.equal(resolveAuthKitMethod("GoogleOAuth"), "google");
});

test("resolveAuthKitMethod: no provider (passkey/email-code button) maps to 'passkey'", () => {
    assert.equal(resolveAuthKitMethod(undefined), "passkey");
});

test("resolveAuthKitMethod: any other/unrecognized provider falls back to 'passkey'", () => {
    assert.equal(resolveAuthKitMethod("SomeOtherProvider"), "passkey");
});

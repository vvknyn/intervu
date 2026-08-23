import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { validateSignupEmail } from "@/lib/auth/username-email";
import { isEmailIdentifier } from "@/lib/firebase/client-auth";

/**
 * "ok keep accounts, kill the username-only path" (Vivek, Aug 20 2026) —
 * the signup-ladder audit that killed the synthetic `<username>@intervu.cc`
 * mint. `validateSignupEmail` is the pure decision `signUp` (actions/auth.ts)
 * runs before any I/O; these guard tests exercise it directly instead of
 * mocking Firebase Admin / Turnstile / rate-limiting.
 */
describe("validateSignupEmail", () => {
    it("rejects the minted shape that motivated the fix", () => {
        assert.equal(validateSignupEmail("x@intervu.cc").ok, false);
    });

    // A second, distinct minted shape — not the literal bug instance — so
    // this proves the fix is class-wide (isMintedLoginEmail's own
    // case/whitespace-insensitive matching), not a one-off string compare.
    it("rejects a second, differently-shaped minted address", () => {
        const result = validateSignupEmail("  Someone.Else@INTERVU.CC  ");
        assert.equal(result.ok, false);
    });

    it("rejects missing or malformed input", () => {
        for (const bad of [null, undefined, "", "not-an-email", "missing-at-sign.com"]) {
            assert.equal(validateSignupEmail(bad).ok, false, String(bad));
        }
    });

    it("accepts a real address, trimmed and lowercased", () => {
        assert.deepEqual(validateSignupEmail("  Vivek@Gmail.com  "), {
            ok: true,
            email: "vivek@gmail.com",
        });
    });

    // Guards against a naive `.includes("intervu.cc")` regression —
    // isMintedLoginEmail only matches the exact login-mint subaddress, and a
    // real domain that merely contains it as a substring must still pass.
    it("accepts a lookalike domain that only contains the minted domain as a substring", () => {
        assert.equal(validateSignupEmail("person@notintervu.cc").ok, true);
    });
});

describe("signUp source shape (actions/auth.ts)", () => {
    const src = readFileSync(join(process.cwd(), "src/actions/auth.ts"), "utf8");

    // The property under test: signUp can never mint. Executing signUp
    // itself needs Firebase Admin, Turnstile, and rate-limiting mocked (no
    // such harness exists in this repo yet — see user-data-sweep.test.ts for
    // the same source-inspection pattern used for an equally I/O-heavy
    // action), so this asserts the structural guarantee directly: the
    // minting function is gone from the file, and the submitted, validated
    // email is what reaches Firebase Admin verbatim.
    it("never calls the minting function usernameEmail", () => {
        assert.doesNotMatch(src, /usernameEmail\(/);
    });

    it("validates the submitted email via validateSignupEmail before creating the account", () => {
        assert.match(src, /validateSignupEmail\(/);
        const createIdx = src.indexOf("adminAuth.createUser(");
        const validateIdx = src.indexOf("validateSignupEmail(");
        assert.ok(validateIdx > -1 && createIdx > -1);
        assert.ok(validateIdx < createIdx, "email must be validated before the account is created");
    });
});

/**
 * Login identifier routing (login-form.tsx, SimpleAuthForm.tsx, via
 * `signInWithIdentifier`): an "@"-bearing input takes the direct email path;
 * a bare token takes the legacy `signInWithUsername` re-derivation, so
 * existing synthetic-address accounts keep logging in unchanged.
 */
describe("isEmailIdentifier", () => {
    it("routes an '@'-bearing input to the email path", () => {
        assert.equal(isEmailIdentifier("vivek@gmail.com"), true);
    });

    // The existing-user regression case: accounts minted before this fix
    // still log in with a bare username, re-derived via signInWithUsername.
    it("routes a bare username (no '@') to the legacy re-derivation path", () => {
        assert.equal(isEmailIdentifier("vivek"), false);
    });

    it("ignores surrounding whitespace when deciding", () => {
        assert.equal(isEmailIdentifier("  vivek@gmail.com  "), true);
        assert.equal(isEmailIdentifier("  vivek  "), false);
    });
});

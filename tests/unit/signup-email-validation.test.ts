import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { validateSignupEmail, isEmailIdentifier } from "@/lib/auth/username-email";

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

    // `screenSignupEmail` (email-quality.ts) folded into this same call
    // site — verifies the wiring, not just the underlying function (that's
    // email-quality.test.ts's job).
    it("rejects a disposable address and reports it as the reason, for telemetry", () => {
        const result = validateSignupEmail("x@mailinator.com");
        assert.equal(result.ok, false);
        assert.equal((result as { reason?: string }).reason, "disposable");
    });

    it("rejects malformed syntax and reports it as the reason, distinctly from the anti-mint rejection", () => {
        const malformed = validateSignupEmail("a@@b.com") as { ok: false; reason?: string };
        assert.equal(malformed.reason, "syntax");

        // The minted-address rejection is a separate concern — it must not
        // carry an email-quality `reason`, or a caller logging telemetry on
        // `reason` would misclassify it as a quality complaint.
        const minted = validateSignupEmail("x@intervu.cc") as { ok: false; reason?: string };
        assert.equal(minted.reason, undefined);
    });
});

/**
 * Login identifier routing (login-form.tsx, via `signInWithIdentifier`;
 * SimpleAuthForm.tsx is gone as of the 2026-08-27 auth/docs redesign —
 * LoginForm now owns this logic alone): an "@"-bearing input takes the
 * direct email path;
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

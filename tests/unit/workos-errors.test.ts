import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    friendlyWorkosAuthMessage,
    workosErrorCodes,
    WORKOS_EMAIL_TAKEN_MESSAGE,
    WORKOS_INVALID_CREDENTIALS_MESSAGE,
    WORKOS_RATE_LIMITED_MESSAGE,
    WORKOS_WEAK_PASSWORD_MESSAGE,
} from "../../src/lib/auth/workos-errors";

/**
 * Incident 2026-10-01 (PostHog replay, India, /jobs?q=Remote+Frontend+Developer):
 * a visitor's first Create account press came back "Failed to create account",
 * the fallback for any WorkOS refusal. They pressed six more times and got
 * "Too many attempts". The two refusals a person can fix — a password WorkOS's
 * policy rejects and an email that already has an account — now say so.
 */

/** Built the way the SDK's own `UnprocessableEntityException` constructor builds it (factory-*.mjs). */
function sdk422(code: string, errors: Array<{ code: string }>) {
    const requirement = errors.length === 1 ? "requirement" : "requirements";
    let message = `The following ${requirement} must be met:\n`;
    for (const e of errors) message = message.concat(`\t${e.code}\n`);
    return { name: "UnprocessableEntityException", status: 422, code, message };
}

describe("workosErrorCodes", () => {
    it("reads the top-level code and the codes the SDK folded into a 422 message", () => {
        assert.deepEqual(
            workosErrorCodes(sdk422("password_strength_error", [{ code: "password_too_short" }, { code: "password_pwned" }])),
            ["password_strength_error", "password_too_short", "password_pwned"],
        );
    });

    it("reads errors[].code when a 400 keeps the list", () => {
        assert.deepEqual(workosErrorCodes({ name: "BadRequestException", status: 400, code: "x", errors: [{ code: "y" }, {}] }), ["x", "y"]);
    });

    it("never treats free text as a code", () => {
        assert.deepEqual(workosErrorCodes({ message: "Password must be at least 10 characters" }), []);
        assert.deepEqual(workosErrorCodes(null), []);
        assert.deepEqual(workosErrorCodes("boom"), []);
    });
});

describe("friendlyWorkosAuthMessage", () => {
    it("a refused password says why, on signup and on reset alike", () => {
        for (const codes of [["password_too_weak"], ["password_pwned"], ["password_too_short"]]) {
            const err = sdk422("password_strength_error", codes.map((code) => ({ code })));
            assert.equal(friendlyWorkosAuthMessage(err, "fallback"), WORKOS_WEAK_PASSWORD_MESSAGE);
        }
    });

    it("an email that already has an account says so and points to sign-in, as a 409 or a 422", () => {
        assert.equal(friendlyWorkosAuthMessage({ name: "ConflictException", status: 409 }, "fallback"), WORKOS_EMAIL_TAKEN_MESSAGE);
        assert.equal(
            friendlyWorkosAuthMessage(sdk422("user_creation_error", [{ code: "email_not_available" }]), "fallback"),
            WORKOS_EMAIL_TAKEN_MESSAGE,
        );
        assert.match(WORKOS_EMAIL_TAKEN_MESSAGE, /Sign in instead/);
    });

    it("keeps the existing mappings", () => {
        assert.equal(friendlyWorkosAuthMessage({ name: "UnauthorizedException" }, "fallback"), WORKOS_INVALID_CREDENTIALS_MESSAGE);
        assert.equal(friendlyWorkosAuthMessage({ status: 429 }, "fallback"), WORKOS_RATE_LIMITED_MESSAGE);
    });

    it("any other refusal takes the caller's fallback, never WorkOS's own text", () => {
        assert.equal(friendlyWorkosAuthMessage(sdk422("user_creation_error", [{ code: "something_new" }]), "fallback"), "fallback");
        assert.equal(friendlyWorkosAuthMessage({ name: "AuthenticationException", status: 403 }, "fallback"), "fallback");
        assert.equal(friendlyWorkosAuthMessage(new Error("raw"), "fallback"), "fallback");
    });
});

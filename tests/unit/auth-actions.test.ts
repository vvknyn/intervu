import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { User, AuthenticationResponse } from "@workos-inc/node";

import {
    signUpCore,
    signInCore,
    requestPasswordResetCore,
    confirmPasswordResetCore,
} from "../../src/actions/auth";
import type { AuthActionDeps } from "../../src/lib/auth/auth-action-deps";
import { usernameEmail } from "../../src/lib/auth/username-email";

// `getSiteUrl()` (called inside signUpCore/signInCore/requestPasswordResetCore
// to build the session-save URL and the reset link) reads this at call time
// and throws when it's unset — `tsx --test` doesn't load `.env.local` the way
// Next.js does, so it's set here directly, same convention as
// seo-constants.test.ts / digest-pg-lane.test.ts / agent-tools.test.ts.
process.env.NEXT_PUBLIC_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://intervuhq.com";

/**
 * `signUpCore`/`signInCore`/`requestPasswordResetCore`/`confirmPasswordResetCore`
 * are the pure decisions behind `actions/auth.ts`'s "use server" wrappers —
 * same deps-first-argument convention as `email-follow-action.test.ts`'s
 * `ContactCookieFollowDeps`. Exercised directly against fake `AuthActionDeps`
 * slices, so none of this needs the WorkOS SDK, Firestore, Turnstile, or
 * rate-limiting mocked.
 */

function fakeUser(overrides: Partial<User> = {}): User {
    return {
        id: "user_1",
        email: "person@example.com",
        emailVerified: true,
        firstName: null,
        lastName: null,
        profilePictureUrl: null,
        object: "user",
        createdAt: "2026-08-27T00:00:00.000Z",
        updatedAt: "2026-08-27T00:00:00.000Z",
        externalId: null,
        metadata: {},
        lastSignInAt: null,
        ...overrides,
    } as unknown as User;
}

function fakeAuthResponse(user: User): AuthenticationResponse {
    return {
        user,
        accessToken: "at_1",
        refreshToken: "rt_1",
        organizationId: undefined,
        impersonator: undefined,
        authenticationMethod: undefined,
    } as unknown as AuthenticationResponse;
}

describe("signUpCore — happy path", () => {
    it("creates the WorkOS user, writes the profile, signs in, and saves the session", async () => {
        const created = fakeUser({ id: "user_new" });
        const authResponse = fakeAuthResponse(created);
        const calls: Record<string, unknown[]> = { createUser: [], createProfile: [], deleteUser: [], saveSession: [] };
        const deps: Pick<AuthActionDeps, "createUser" | "deleteUser" | "createProfile" | "authenticateWithPassword" | "saveSession"> = {
            createUser: async (opts) => { calls.createUser.push(opts); return created; },
            deleteUser: async (id) => { calls.deleteUser.push(id); },
            createProfile: async (id, username) => { calls.createProfile.push([id, username]); },
            authenticateWithPassword: async () => authResponse,
            saveSession: async (resp, url) => { calls.saveSession.push([resp, url]); },
        };

        const result = await signUpCore(deps, { username: "alice", password: "hunter22", email: "alice@example.com" });

        assert.deepEqual(result, { success: true, user: created });
        assert.deepEqual(calls.createUser, [{ email: "alice@example.com", password: "hunter22", metadata: { username: "alice" } }]);
        assert.deepEqual(calls.createProfile, [["user_new", "alice"]]);
        assert.equal(calls.deleteUser.length, 0, "no rollback on the happy path");
        assert.equal(calls.saveSession.length, 1);
    });
});

describe("signUpCore — createUser conflict", () => {
    it("maps a ConflictException to the username-taken message without touching the profile", async () => {
        let profileCalls = 0;
        const deps: Pick<AuthActionDeps, "createUser" | "deleteUser" | "createProfile" | "authenticateWithPassword" | "saveSession"> = {
            createUser: async () => { throw { name: "ConflictException" }; },
            deleteUser: async () => { throw new Error("must not be called"); },
            createProfile: async () => { profileCalls++; },
            authenticateWithPassword: async () => { throw new Error("must not be called"); },
            saveSession: async () => { throw new Error("must not be called"); },
        };

        const result = await signUpCore(deps, { username: "bob", password: "hunter22", email: "bob@example.com" });

        assert.deepEqual(result, { error: "Username is already taken" });
        assert.equal(profileCalls, 0);
    });
});

describe("signUpCore — profile write fails after account creation", () => {
    it("rolls back the WorkOS account it just created", async () => {
        const created = fakeUser({ id: "user_orphan" });
        const deletedIds: string[] = [];
        const deps: Pick<AuthActionDeps, "createUser" | "deleteUser" | "createProfile" | "authenticateWithPassword" | "saveSession"> = {
            createUser: async () => created,
            deleteUser: async (id) => { deletedIds.push(id); },
            createProfile: async () => { throw new Error("Firestore is down"); },
            authenticateWithPassword: async () => { throw new Error("must not be called"); },
            saveSession: async () => { throw new Error("must not be called"); },
        };

        const result = await signUpCore(deps, { username: "carol", password: "hunter22", email: "carol@example.com" });

        assert.deepEqual(result, { error: "Profile setup failed. Please try again." });
        assert.deepEqual(deletedIds, ["user_orphan"]);
    });
});

describe("signUpCore — auto sign-in fails after account and profile both exist", () => {
    it("reports success-but-sign-in-again, and does not roll back", async () => {
        const created = fakeUser({ id: "user_signed_up" });
        const deletedIds: string[] = [];
        const deps: Pick<AuthActionDeps, "createUser" | "deleteUser" | "createProfile" | "authenticateWithPassword" | "saveSession"> = {
            createUser: async () => created,
            deleteUser: async (id) => { deletedIds.push(id); },
            createProfile: async () => {},
            authenticateWithPassword: async () => { throw { name: "UnauthorizedException" }; },
            saveSession: async () => {},
        };

        const result = await signUpCore(deps, { username: "dave", password: "hunter22", email: "dave@example.com" });

        assert.deepEqual(result, { error: "Account created — please sign in." });
        assert.equal(deletedIds.length, 0, "the account and profile are real — nothing to roll back");
    });
});

describe("signInCore — identifier resolution", () => {
    it("authenticates an email identifier as-is", async () => {
        const user = fakeUser({ email: "erin@example.com" });
        const authResponse = fakeAuthResponse(user);
        const authCalls: Array<{ email: string; password: string }> = [];
        const deps: Pick<AuthActionDeps, "authenticateWithPassword" | "saveSession"> = {
            authenticateWithPassword: async (opts) => { authCalls.push(opts); return authResponse; },
            saveSession: async () => {},
        };

        const result = await signInCore(deps, { identifier: "  erin@example.com  ", password: "hunter22" });

        assert.deepEqual(result, { success: true, user });
        assert.deepEqual(authCalls, [{ email: "erin@example.com", password: "hunter22" }]);
    });

    // The other case, not the one that motivated resolveLoginEmail: a bare
    // username re-derives the minted `<username>@intervu.cc` address rather
    // than being sent to WorkOS verbatim.
    it("re-derives the minted address for a bare username", async () => {
        const user = fakeUser();
        const authResponse = fakeAuthResponse(user);
        const authCalls: Array<{ email: string; password: string }> = [];
        const deps: Pick<AuthActionDeps, "authenticateWithPassword" | "saveSession"> = {
            authenticateWithPassword: async (opts) => { authCalls.push(opts); return authResponse; },
            saveSession: async () => {},
        };

        await signInCore(deps, { identifier: "frank", password: "hunter22" });

        assert.deepEqual(authCalls, [{ email: usernameEmail("frank"), password: "hunter22" }]);
    });
});

describe("signInCore — bad credentials", () => {
    it("maps an UnauthorizedException to the invalid-credentials message", async () => {
        const deps: Pick<AuthActionDeps, "authenticateWithPassword" | "saveSession"> = {
            authenticateWithPassword: async () => { throw { name: "UnauthorizedException" }; },
            saveSession: async () => { throw new Error("must not be called"); },
        };

        const result = await signInCore(deps, { identifier: "grace@example.com", password: "wrong" });

        assert.deepEqual(result, { error: "Invalid email or password" });
    });
});

describe("requestPasswordResetCore — happy path", () => {
    it("mints a reset link from the token and emails it", async () => {
        const sent: Array<{ email: string; resetUrl: string }> = [];
        const deps: Pick<AuthActionDeps, "createPasswordReset" | "sendPasswordResetEmail"> = {
            createPasswordReset: async () => ({ passwordResetToken: "tok-abc" }),
            sendPasswordResetEmail: async (input) => { sent.push(input); },
        };

        const result = await requestPasswordResetCore(deps, { email: "person@example.com" });

        assert.deepEqual(result, { success: true });
        assert.equal(sent.length, 1);
        assert.equal(sent[0].email, "person@example.com");
        assert.match(sent[0].resetUrl, /\/reset-password\?token=tok-abc$/);
    });
});

describe("requestPasswordResetCore — unregistered email", () => {
    it("still resolves success, and never sends an email — enumeration safety", async () => {
        let emailsSent = 0;
        const deps: Pick<AuthActionDeps, "createPasswordReset" | "sendPasswordResetEmail"> = {
            createPasswordReset: async () => { throw { name: "NotFoundException" }; },
            sendPasswordResetEmail: async () => { emailsSent++; },
        };

        const result = await requestPasswordResetCore(deps, { email: "nobody@example.com" });

        assert.deepEqual(result, { success: true });
        assert.equal(emailsSent, 0);
    });
});

describe("confirmPasswordResetCore — input guards", () => {
    it("rejects a missing token without calling resetPassword", async () => {
        let resetCalls = 0;
        const deps: Pick<AuthActionDeps, "resetPassword"> = { resetPassword: async () => { resetCalls++; } };

        const result = await confirmPasswordResetCore(deps, { token: "", newPassword: "hunter22" });

        assert.deepEqual(result, { error: "This reset link is invalid or has expired." });
        assert.equal(resetCalls, 0);
    });

    it("rejects a password under 6 characters without calling resetPassword", async () => {
        let resetCalls = 0;
        const deps: Pick<AuthActionDeps, "resetPassword"> = { resetPassword: async () => { resetCalls++; } };

        const result = await confirmPasswordResetCore(deps, { token: "tok-abc", newPassword: "short" });

        assert.deepEqual(result, { error: "Password must be at least 6 characters" });
        assert.equal(resetCalls, 0);
    });
});

describe("confirmPasswordResetCore — happy path", () => {
    it("resets the password with the token and new password", async () => {
        const calls: Array<{ token: string; newPassword: string }> = [];
        const deps: Pick<AuthActionDeps, "resetPassword"> = {
            resetPassword: async (opts) => { calls.push(opts); },
        };

        const result = await confirmPasswordResetCore(deps, { token: "tok-abc", newPassword: "hunter22" });

        assert.deepEqual(result, { success: true });
        assert.deepEqual(calls, [{ token: "tok-abc", newPassword: "hunter22" }]);
    });
});

describe("confirmPasswordResetCore — expired or invalid token", () => {
    it("maps the SDK failure to the invalid-link message", async () => {
        const deps: Pick<AuthActionDeps, "resetPassword"> = {
            resetPassword: async () => { throw { name: "BadRequestException" }; },
        };

        const result = await confirmPasswordResetCore(deps, { token: "tok-expired", newPassword: "hunter22" });

        assert.deepEqual(result, { error: "This reset link is invalid or has expired." });
    });
});

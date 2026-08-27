"use server";

import { after } from "next/server";
import type { User } from "@workos-inc/node";
import { getServerUser } from "@/lib/auth/server-user";
import { getAdminDb } from "@/lib/firebase/admin";
import { runUserDataPlan } from "@/lib/db/user-data";
import { isMintedLoginEmail, validateSignupEmail, resolveLoginEmail } from "@/lib/auth/username-email";
import { getClientIp } from "@/lib/shield/client-ip";
import { allowAuthSignupRequest, allowAuthSignInRequest, allowAuthResetRequest } from "@/lib/shield/rate-limit";
import { verifyTurnstile } from "@/lib/shield/turnstile";
import { forgetIdentity } from "@/lib/identity/forget";
import { getIntervuPg } from "@/lib/pg/pool";
import { friendlyWorkosAuthMessage } from "@/lib/auth/workos-errors";
import { resolveWorkosUserId, getWorkosUserManagement } from "@/lib/auth/workos-runtime";
import { provisionAppAccess } from "@/lib/auth/provisioning";
import { getSiteUrl } from "@/lib/seo/constants";
import { type AuthActionDeps, realAuthActionDeps } from "@/lib/auth/auth-action-deps";

export async function checkUsernameAvailability(username: string) {
    try {
        const db = getAdminDb();
        const snapshot = await db
            .collection("profiles")
            .where("username", "==", username)
            .get();

        if (snapshot.empty) {
            return { available: true };
        }

        return { available: false, message: "Username is already taken" };
    } catch (error: any) {
        console.error("Error checking username availability:", error);
        return { available: false, message: `Error: ${error.message}` };
    }
}

/**
 * Pure decision, injected deps: create the WorkOS user + Firestore profile,
 * then sign the fresh account straight in. Unit-testable against a fake
 * `AuthActionDeps` — no WorkOS SDK, no Firestore, no Next.js request scope.
 *
 * Rollback-on-profile-failure mirrors the pre-migration Firebase version:
 * a Firestore write failing after `createUser` succeeded must not strand an
 * account with no profile, so the WorkOS user is deleted and the caller can
 * retry cleanly.
 */
export async function signUpCore(
    deps: Pick<AuthActionDeps, "createUser" | "deleteUser" | "createProfile" | "authenticateWithPassword" | "saveSession">,
    input: { username: string; password: string; email: string },
): Promise<{ error: string } | { success: true; user: User }> {
    const { username, password, email } = input;

    let created: User;
    try {
        created = await deps.createUser({ email, password, metadata: { username } });
    } catch (error) {
        if ((error as { name?: string } | null)?.name === "ConflictException") {
            return { error: "Username is already taken" };
        }
        return { error: friendlyWorkosAuthMessage(error, "Failed to create account") };
    }

    try {
        await deps.createProfile(created.id, username);
    } catch (profileError) {
        console.error("[Auth] Profile creation error:", profileError);
        await deps.deleteUser(created.id).catch((rollbackError) =>
            console.error("[Auth] Signup rollback failed:", rollbackError),
        );
        return { error: "Profile setup failed. Please try again." };
    }

    try {
        const authResponse = await deps.authenticateWithPassword({ email, password });
        await deps.saveSession(authResponse, getSiteUrl());
        return { success: true, user: authResponse.user };
    } catch (error) {
        console.error("[Auth] Post-signup sign-in failed:", error);
        // The account and its profile both exist — only the automatic
        // sign-in failed. A distinct message from a bad-credentials sign-in
        // failure: this person's password is correct, they just need to
        // submit it once more.
        return { error: "Account created — please sign in." };
    }
}

export async function signUp(
    prevState: any,
    formData: FormData,
): Promise<{ error: string } | { success: true }> {
    const username = formData.get("username") as string;
    const password = formData.get("password") as string;
    const turnstileToken = formData.get("turnstileToken") as string | null;

    if (!username || !password) {
        return { error: "Username and password are required" };
    }

    if (username.length < 3) {
        return { error: "Username must be at least 3 characters" };
    }

    // A real, mail-deliverable address is now mandatory ("ok keep accounts,
    // kill the username-only path" — Vivek, Aug 20 2026). The send layer
    // (lib/email/send.ts, welcome.ts, digest/send.ts) refuses anything
    // shaped like the old synthesized `<username>@intervu.cc` address, so an
    // account registered under one could never receive the alerts/tracker
    // digest this app now sells on signup. Checked before any I/O below —
    // cheapest check first, and it's what keeps this decision unit-testable
    // without mocking Turnstile/rate-limiting/WorkOS.
    const emailResult = validateSignupEmail(formData.get("email"));
    if (!emailResult.ok) {
        return { error: emailResult.error };
    }
    const email = emailResult.email;

    const ip = await getClientIp();
    if (!allowAuthSignupRequest(ip)) {
        return { error: "Too many attempts — try again in a few minutes." };
    }

    const turnstile = await verifyTurnstile(turnstileToken, ip);
    if (turnstile.status === "reject") {
        return { error: "Verification failed — please try again." };
    }

    // Check availability again to be safe (a race against another signup
    // between the client's earlier check and this submit).
    const { available } = await checkUsernameAvailability(username);
    if (!available) {
        return { error: "Username is already taken" };
    }

    const deps = await realAuthActionDeps();
    const result = await signUpCore(deps, { username, password, email });
    if ("error" in result) return result;

    // Deferred, not awaited: welcome email + credit grant + org membership
    // must never turn a successful signup into an error, and a person
    // creating an account should not wait on Resend or Firestore to see it
    // succeed. Same reasoning `POST /api/auth/session` used to run this
    // under before the WorkOS migration — see provisioning.ts's module doc.
    after(() =>
        provisionAppAccess(deps.provisioning, result.user).catch((err) =>
            console.error("[Auth] post-signup provisioning failed:", err),
        ),
    );

    return { success: true };
}

/**
 * Pure decision, injected deps: resolve the typed identifier to a login
 * email (`resolveLoginEmail` — email as-is, bare username re-derives the
 * legacy `<username>@intervu.cc` address) and authenticate.
 */
export async function signInCore(
    deps: Pick<AuthActionDeps, "authenticateWithPassword" | "saveSession">,
    input: { identifier: string; password: string },
): Promise<{ error: string } | { success: true; user: User }> {
    const email = resolveLoginEmail(input.identifier);
    try {
        const authResponse = await deps.authenticateWithPassword({ email, password: input.password });
        await deps.saveSession(authResponse, getSiteUrl());
        return { success: true, user: authResponse.user };
    } catch (error) {
        return { error: friendlyWorkosAuthMessage(error, "Sign-in failed — try again in a moment.") };
    }
}

export async function signIn(
    prevState: any,
    formData: FormData,
): Promise<{ error: string } | { success: true }> {
    const identifier = formData.get("username") as string;
    const password = formData.get("password") as string;

    if (!identifier || !password) {
        return { error: "Username and password are required" };
    }

    const ip = await getClientIp();
    if (!allowAuthSignInRequest(ip)) {
        return { error: "Too many attempts — wait a minute and try again." };
    }

    const deps = await realAuthActionDeps();
    const result = await signInCore(deps, { identifier, password });
    if ("error" in result) return result;

    // Same deferred-provisioning reasoning as `signUp` above — a returning
    // user's sign-in must not wait on, or fail because of, the welcome/credit/
    // membership self-heal.
    after(() =>
        provisionAppAccess(deps.provisioning, result.user).catch((err) =>
            console.error("[Auth] post-signin provisioning failed:", err),
        ),
    );

    return { success: true };
}

/**
 * Request a password-reset email. Always resolves `{success: true}` —
 * never reveals whether `input.email` belongs to an account. WorkOS raises
 * `NotFoundException` for an unregistered email; that failure is logged and
 * swallowed here rather than surfaced, same enumeration-safety guarantee
 * the old Firebase-backed UI forced by catching `auth/user-not-found`.
 */
export async function requestPasswordResetCore(
    deps: Pick<AuthActionDeps, "createPasswordReset" | "sendPasswordResetEmail">,
    input: { email: string },
): Promise<{ success: true }> {
    try {
        const { passwordResetToken } = await deps.createPasswordReset({ email: input.email });
        const resetUrl = `${getSiteUrl()}/reset-password?token=${encodeURIComponent(passwordResetToken)}`;
        await deps.sendPasswordResetEmail({ email: input.email, resetUrl });
    } catch (error) {
        console.error("[Auth] Password reset request failed:", error);
    }
    return { success: true };
}

export async function requestPasswordResetAction(input: { email: string }): Promise<{ success: true }> {
    const ip = await getClientIp();
    if (!allowAuthResetRequest(ip)) {
        // Same neutral shape as the happy path — rate-limiting must not
        // become a second way to learn whether an email is registered.
        return { success: true };
    }
    const deps = await realAuthActionDeps();
    return requestPasswordResetCore(deps, input);
}

export async function confirmPasswordResetCore(
    deps: Pick<AuthActionDeps, "resetPassword">,
    input: { token: string; newPassword: string },
): Promise<{ error: string } | { success: true }> {
    if (!input.token) {
        return { error: "This reset link is invalid or has expired." };
    }
    // Matches the signup form's own "6+ characters" copy (login-form.tsx) —
    // not a new, stricter rule invented for this path.
    if (input.newPassword.length < 6) {
        return { error: "Password must be at least 6 characters" };
    }
    try {
        await deps.resetPassword({ token: input.token, newPassword: input.newPassword });
        return { success: true };
    } catch (error) {
        return { error: friendlyWorkosAuthMessage(error, "This reset link is invalid or has expired.") };
    }
}

export async function confirmPasswordResetAction(
    input: { token: string; newPassword: string },
): Promise<{ error: string } | { success: true }> {
    const deps = await realAuthActionDeps();
    return confirmPasswordResetCore(deps, input);
}

/**
 * Close the account and remove everything it owns.
 *
 * WHICH collections comes from `MIGRATION_MANIFEST` via `runUserDataPlan`,
 * never from a list kept here. The literal list this replaced named nine
 * collections and reached them only by a `user_id` field or the profile doc
 * id, so closing an account left behind every saved resume version
 * (`profiles/<uid>/resume_history`, which Firestore keeps even after the
 * parent document is deleted), both `users/<uid>` subcollections, and every
 * agent credential and pairing code. On 2026-08-18 six of the eight uids
 * owning saved resumes had no Auth account left.
 *
 * ORDER MATTERS. Firestore first, WorkOS last. Deleting the auth user first
 * means any later failure strands the remaining documents for good: the
 * account is gone, so nobody can sign in to retry the sweep.
 *
 * Also sweeps the PG identity store (verified-email-follow's `forgetIdentity`,
 * see `docs/specs/2026-08-19-verified-email-follow-design.md` item 7) when
 * the account's email is a real address rather than the synthetic
 * `<username>@intervu.cc` a password signup mints — a minted address was
 * never entered into the email-follow flow, so there is nothing there to
 * find, and running the lookup anyway would just be wasted PG round trips.
 *
 * The WorkOS session cookie itself is cleared client-side, not here: the
 * caller (`SettingsContainer`) hits `/auth/signout` right after this
 * resolves — the same route every ordinary sign-out uses — rather than this
 * action reaching for `redirect()`, which would abort a server action's
 * return value instead of handing the caller a `{}`/`{error}` result.
 */
export async function deleteAccount(): Promise<{ error?: string }> {
    const user = await getServerUser();

    if (!user) {
        return { error: "Unauthorized" };
    }

    try {
        const db = getAdminDb();
        const uid = user.uid;

        const owned = await runUserDataPlan(uid, db);
        const paths = Object.values(owned).flatMap((docs) => docs.map((d) => d.path));

        // 500 writes is Firestore's hard limit for one commit.
        for (let i = 0; i < paths.length; i += 500) {
            const batch = db.batch();
            for (const path of paths.slice(i, i + 500)) batch.delete(db.doc(path));
            await batch.commit();
        }

        const userManagement = await getWorkosUserManagement();
        const workosUserId = await resolveWorkosUserId(
            (externalId) => userManagement.getUserByExternalId(externalId),
            uid,
        );
        await userManagement.deleteUser(workosUserId);

        if (user.email && !isMintedLoginEmail(user.email)) {
            await forgetIdentity(getIntervuPg(), user.email);
        }

        return {};
    } catch (error) {
        console.error("[Auth] Delete account error:", error);
        return { error: error instanceof Error ? error.message : "Failed to delete account" };
    }
}

"use server";

import { after } from "next/server";
import type { User } from "@workos-inc/node";
import { getServerUser } from "@/lib/auth/server-user";
import { getAdminDb } from "@/lib/firebase/admin";
import { runUserDataPlan } from "@/lib/db/user-data";
import { isMintedLoginEmail, validateSignupEmail, resolveLoginEmail } from "@/lib/auth/username-email";
import { assessSignupEmail, realEmailQualityDeps, emailDomain, EMAIL_QUALITY_MESSAGES } from "@/lib/auth/email-quality";
import { getClientIp } from "@/lib/shield/client-ip";
import {
    allowAuthSignupSubmit,
    allowAuthAccountCreate,
    allowAuthSignInRequest,
    allowAuthResetRequest,
} from "@/lib/shield/rate-limit";
import { turnstileRejectMessage, verifyTurnstile } from "@/lib/shield/turnstile";
import { forgetIdentity } from "@/lib/identity/forget";
import { getIntervuPg, getTelemetryForgetPg } from "@/lib/pg/pool";
import { friendlyWorkosAuthMessage, workosErrorCodes } from "@/lib/auth/workos-errors";
import { newPasswordProblem } from "@/lib/auth/password-rules";
import { SIGNUP_FAILED_MESSAGE, signupRateLimitMessage, signInRateLimitMessage } from "@/lib/auth/auth-refusal-copy";
import { logServer } from "@/lib/observability/posthog-logs";
import { resolveWorkosUserId, getWorkosUserManagement } from "@/lib/auth/workos-runtime";
import { provisionAppAccess } from "@/lib/auth/provisioning";
import { claimSignupEvent } from "@/lib/auth/signup-event";
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
 * Every refused signup goes to the server log with WHY (never the email,
 * username or password). Before this, a refusal was a `console.warn` on the
 * box at best, so the 2026-10-01 replay showed seven failed presses and
 * nothing anywhere said what failed the first one.
 */
function logSignupRefused(reason: string, attrs: Record<string, string | number | undefined> = {}): void {
    logServer("warn", `signup refused: ${reason}`, { reason, ...attrs });
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
        // A WorkOS conflict is about the EMAIL: WorkOS has no usernames (ours
        // rides in `metadata`), so this used to say "Username is already
        // taken" to someone whose username was fine.
        logSignupRefused("workos_create_user", {
            error_name: (error as { name?: string } | null)?.name ?? "unknown",
            error_status: (error as { status?: number } | null)?.status,
            error_codes: workosErrorCodes(error).join(",") || undefined,
        });
        return { error: friendlyWorkosAuthMessage(error, SIGNUP_FAILED_MESSAGE) };
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
): Promise<{ error: string } | { success: true; signupCompleted: boolean }> {
    const username = formData.get("username") as string;
    const password = formData.get("password") as string;
    const turnstileToken = formData.get("turnstileToken") as string | null;

    // Free, local checks first (no I/O, nothing counted against the visitor):
    // a refusal here costs nothing and says exactly what to change.
    if (!username || !password) {
        return { error: "Username and password are required" };
    }

    if (username.length < 3) {
        return { error: "Username must be at least 3 characters" };
    }

    const passwordProblem = newPasswordProblem(password);
    if (passwordProblem) {
        return { error: passwordProblem };
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
        if (emailResult.reason) {
            console.warn("[Auth] signup_email_rejected", { reason: emailResult.reason, domain: emailResult.domain });
        }
        return { error: emailResult.error };
    }
    const email = emailResult.email;

    // Flood guard (generous): only guards the siteverify call and the lookups
    // behind it. The tight budget is `allowAuthAccountCreate` below.
    const ip = await getClientIp();
    if (!allowAuthSignupSubmit(ip)) {
        logSignupRefused("rate_limited_submit");
        return { error: signupRateLimitMessage(allowAuthSignupSubmit.retryAfterMs(ip)) };
    }

    const turnstile = await verifyTurnstile(turnstileToken, ip);
    if (turnstile.status === "reject") {
        logSignupRefused("turnstile", { turnstile_reason: turnstile.reason });
        return { error: `${turnstileRejectMessage(turnstile.reason)} Or continue with Google or an email code.` };
    }

    // Deliverability (MX/A/AAAA) check runs only here — after the flood guard
    // and Turnstile — so a DNS resolver round trip is never a free
    // amplification vector for someone probing arbitrary domains.
    const emailQuality = await assessSignupEmail(email, realEmailQualityDeps);
    if (!emailQuality.ok) {
        console.warn("[Auth] signup_email_rejected", { reason: emailQuality.reason, domain: emailDomain(email) });
        logSignupRefused("email_quality", { email_reason: emailQuality.reason });
        return { error: EMAIL_QUALITY_MESSAGES[emailQuality.reason] };
    }

    // Check availability again to be safe (a race against another signup
    // between the client's earlier check and this submit).
    const { available } = await checkUsernameAvailability(username);
    if (!available) {
        logSignupRefused("username_taken");
        return { error: "Username is already taken" };
    }

    // The tight per-IP budget counts only what is about to become a WorkOS
    // `createUser` call — never a submit refused above for something the
    // visitor can fix (see rate-limit.ts, 2026-10-01).
    if (!allowAuthAccountCreate(ip)) {
        logSignupRefused("rate_limited_create");
        return { error: signupRateLimitMessage(allowAuthAccountCreate.retryAfterMs(ip)) };
    }

    const deps = await realAuthActionDeps();
    const result = await signUpCore(deps, { username, password, email });
    if ("error" in result) return result;

    // Deferred, not awaited: welcome email + org membership
    // must never turn a successful signup into an error, and a person
    // creating an account should not wait on Resend or Firestore to see it
    // succeed. Same reasoning `POST /api/auth/session` used to run this
    // under before the WorkOS migration — see provisioning.ts's module doc.
    after(() =>
        provisionAppAccess(deps.provisioning, result.user, "password").catch((err) =>
            console.error("[Auth] post-signup provisioning failed:", err),
        ),
    );

    // The client reports `signup_completed` only when this claim is won, the
    // same chokepoint the AuthKit callback uses, so a later Google sign-in on
    // this account cannot report a second signup.
    return { success: true, signupCompleted: await claimSignupEvent(result.user) };
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
        return { error: signInRateLimitMessage(allowAuthSignInRequest.retryAfterMs(ip)) };
    }

    const deps = await realAuthActionDeps();
    const result = await signInCore(deps, { identifier, password });
    if ("error" in result) return result;

    // Same deferred-provisioning reasoning as `signUp` above — a returning
    // user's sign-in must not wait on, or fail because of, the welcome/
    // membership self-heal.
    after(() =>
        provisionAppAccess(deps.provisioning, result.user, "password").catch((err) =>
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
    // The same local rule as signup (password-rules.ts): WorkOS applies its
    // own policy to a reset too, and a refusal from it used to read "This
    // reset link is invalid or has expired" — now mapped in workos-errors.ts.
    const passwordProblem = newPasswordProblem(input.newPassword);
    if (passwordProblem) {
        return { error: passwordProblem };
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
            await forgetIdentity(getIntervuPg(), getTelemetryForgetPg(), user.email);
        }

        return {};
    } catch (error) {
        console.error("[Auth] Delete account error:", error);
        return { error: error instanceof Error ? error.message : "Failed to delete account" };
    }
}

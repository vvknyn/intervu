"use server";

import { after } from "next/server";
import type { User } from "@workos-inc/node";
import { getServerUser } from "@/lib/auth/server-user";
import { deleteLegacyFirebaseUser, getAdminDb } from "@/lib/firebase/admin";
import {
    deletePosthogPerson,
    deleteStripeCustomer,
    eraseAccount,
    eraseIdentityStore,
    findStripeCustomerByUid,
    erasePgRows,
    eraseMirrorStore,
    eraseTelemetry,
    isSkipped,
    storeEraseDeps,
} from "@/lib/account/erase-account";
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
import { SETTINGS_MESSAGES } from "@/lib/copy";
import { getIntervuPg, getTelemetryForgetPg } from "@/lib/pg/pool";
import { friendlyWorkosAuthMessage, verifyStepFor, workosErrorCodes, type VerifyStep } from "@/lib/auth/workos-errors";
import { newPasswordProblem } from "@/lib/auth/password-rules";
import { SIGNUP_FAILED_MESSAGE, signupRateLimitMessage, signInRateLimitMessage } from "@/lib/auth/auth-refusal-copy";
import { logServer } from "@/lib/observability/posthog-logs";
import { resolveWorkosUserId, getWorkosUserManagement } from "@/lib/auth/workos-runtime";
import { provisionAppAccess } from "@/lib/auth/provisioning";
import { claimSignupEvent } from "@/lib/auth/signup-event";
import { getSiteUrl } from "@/lib/seo/constants";
import { normalizeEmailCode } from "@/lib/auth/email-code-pending";
import {
    EMAIL_CODE_FORMAT_MESSAGE,
    EMAIL_CODE_WRONG_MESSAGE,
    emailCodeRateLimitMessage,
} from "@/lib/auth/email-code-copy";
import { allowAuthEmailCodeRequest } from "@/lib/shield/rate-limit";
import { deriveUsername } from "@/lib/auth/derive-username";
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
): Promise<{ error: string } | { notice: string; kind: "success" | "info" } | VerifyStep | { success: true; user: User }> {
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
        const step = verifyStepFor(error, email);
        if (step) return step;
        console.error("[Auth] Post-signup sign-in failed:", error);
        // The account and its profile both exist — only the automatic
        // sign-in failed. A distinct message from a bad-credentials sign-in
        // failure: this person's password is correct, they just need to
        // submit it once more.
        return { notice: "Account created — sign in to continue.", kind: "success" };
    }
}

export async function signUp(
    prevState: any,
    formData: FormData,
): Promise<{ error: string } | { notice: string; kind: "success" | "info" } | VerifyStep | { success: true; signupCompleted: boolean }> {
    const password = formData.get("password") as string;
    const turnstileToken = formData.get("turnstileToken") as string | null;

    // Free, local checks first (no I/O, nothing counted against the visitor):
    // a refusal here costs nothing and says exactly what to change.
    if (!password) {
        return { error: "Email and password are required" };
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

    // The form no longer asks for a username: derive it from the email.
    let username: string;
    try {
        username = await deriveUsername(email, async (u) => !(await checkUsernameAvailability(u)).available);
    } catch {
        logSignupRefused("username_unavailable");
        return { error: SIGNUP_FAILED_MESSAGE };
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
    if (!("success" in result)) return result;

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
): Promise<{ error: string } | VerifyStep | { success: true; user: User }> {
    const email = resolveLoginEmail(input.identifier);
    try {
        const authResponse = await deps.authenticateWithPassword({ email, password: input.password });
        await deps.saveSession(authResponse, getSiteUrl());
        return { success: true, user: authResponse.user };
    } catch (error) {
        return verifyStepFor(error, email) ?? { error: friendlyWorkosAuthMessage(error, "Sign-in failed — try again in a moment.") };
    }
}

export async function signIn(
    prevState: any,
    formData: FormData,
): Promise<{ error: string } | VerifyStep | { success: true }> {
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
    if (!("success" in result)) return result;

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
 * Redeem the emailed code against the pending token WorkOS handed back
 * (`VerifyStep`), then save the session as a password sign-in would.
 * A refused code keeps the step open: WorkOS lets the same token try again.
 */
export async function verifyPasswordEmailCodeCore(
    deps: Pick<AuthActionDeps, "authenticateWithEmailVerification" | "saveSession">,
    input: { code: unknown; pendingAuthenticationToken: string },
): Promise<{ error: string } | { success: true; user: User }> {
    const code = normalizeEmailCode(input.code);
    if (!code) return { error: EMAIL_CODE_FORMAT_MESSAGE };
    try {
        const authResponse = await deps.authenticateWithEmailVerification({
            code,
            pendingAuthenticationToken: input.pendingAuthenticationToken,
        });
        await deps.saveSession(authResponse, getSiteUrl());
        return { success: true, user: authResponse.user };
    } catch (error) {
        // Why, never the code or token.
        const e = error as { name?: string; status?: number } | null;
        logServer("warn", "email code refused", { error_name: e?.name ?? "unknown", error_status: e?.status });
        return { error: EMAIL_CODE_WRONG_MESSAGE };
    }
}

export async function verifyPasswordEmailCode(
    prevState: any,
    formData: FormData,
): Promise<{ error: string } | { success: true; signupCompleted: boolean }> {
    const pendingAuthenticationToken = formData.get("pendingAuthenticationToken");
    if (typeof pendingAuthenticationToken !== "string" || !pendingAuthenticationToken) {
        return { error: EMAIL_CODE_WRONG_MESSAGE };
    }
    const ip = await getClientIp();
    if (!allowAuthEmailCodeRequest(ip)) {
        return { error: emailCodeRateLimitMessage(allowAuthEmailCodeRequest.retryAfterMs(ip)) };
    }
    const deps = await realAuthActionDeps();
    const result = await verifyPasswordEmailCodeCore(deps, { code: formData.get("code"), pendingAuthenticationToken });
    if (!("success" in result)) return result;

    after(() =>
        provisionAppAccess(deps.provisioning, result.user, "password").catch((err) =>
            console.error("[Auth] post-verify provisioning failed:", err),
        ),
    );
    // A person verifying here is usually finishing a signup; the claim is
    // one-shot per account, so a returning user verifying reports false.
    return { success: true, signupCompleted: await claimSignupEvent(result.user) };
}

export async function resendVerificationCodeCore(
    deps: Pick<AuthActionDeps, "resendVerificationEmail">,
    input: { email: string },
): Promise<{ error: string } | { notice: string; kind: "info" }> {
    try {
        await deps.resendVerificationEmail(input.email);
        return { notice: "We sent a new code. Check your email.", kind: "info" };
    } catch (error) {
        const e = error as { name?: string; status?: number } | null;
        logServer("warn", "verification resend failed", { error_name: e?.name ?? "unknown", error_status: e?.status });
        return { error: "Couldn't send a new code just now. Try again in a minute." };
    }
}

export async function resendVerificationCode(email: string): Promise<{ error: string } | { notice: string; kind: "info" }> {
    const ip = await getClientIp();
    if (!allowAuthEmailCodeRequest(ip)) {
        return { error: emailCodeRateLimitMessage(allowAuthEmailCodeRequest.retryAfterMs(ip)) };
    }
    return resendVerificationCodeCore(await realAuthActionDeps(), { email });
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
 * What gets erased, and in what order, lives in `eraseAccount`
 * (lib/account/erase-account.ts). WHICH collections comes from
 * `MIGRATION_MANIFEST` via `runUserDataPlan`,
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
 * Also sweeps the PG identity store (`eraseIdentityStore`): by the real address
 * when there is one (suppression included), and always by uid, which is the
 * only handle a username account has.
 *
 * The WorkOS session cookie itself is cleared client-side, not here: the
 * caller (`SettingsContainer`) hits `/auth/signout` right after this
 * resolves — the same route every ordinary sign-out uses — rather than this
 * action reaching for `redirect()`, which would abort a server action's
 * return value instead of handing the caller a `{}`/`{error}` result.
 */
export async function deleteAccount(): Promise<{ error?: string; incomplete?: string[] }> {
    const user = await getServerUser();

    if (!user) {
        return { error: "Unauthorized" };
    }

    try {
        const db = getAdminDb();
        const telemetryPg = getTelemetryForgetPg();
        const results = await eraseAccount(
            { uid: user.uid, email: user.email && !isMintedLoginEmail(user.email) ? user.email : null },
            {
                ...storeEraseDeps(db),
                eraseMirrorStore,
                findStripeCustomerByUid: (uid) => findStripeCustomerByUid(uid),
                deleteStripeCustomer: (customerId) => deleteStripeCustomer(customerId),
                deletePgRows: (uid) => erasePgRows(getIntervuPg(), uid),
                deleteTelemetry: (uid) => eraseTelemetry(telemetryPg, uid),
                deleteAnalyticsPerson: (uid) => deletePosthogPerson(uid),
                deleteLegacySignIn: (uid) => deleteLegacyFirebaseUser(uid),
                async deleteSignIn(uid) {
                    const userManagement = await getWorkosUserManagement();
                    const workosUserId = await resolveWorkosUserId(
                        (externalId) => userManagement.getUserByExternalId(externalId),
                        uid,
                    );
                    await userManagement.deleteUser(workosUserId);
                },
                // The ledger rows went by uid above; WorkOS no longer knows the
                // address by now, so forgetIdentity's own lookup would find nobody.
                eraseIdentityStore: (uid, email) => eraseIdentityStore(getIntervuPg(), uid, email),
                logError: (message) => console.error(message),
            },
        );
        // A processor we could not reach still holds the person's data: say so.
        const incomplete = results.filter((r) => isSkipped(r.status)).map((r) => r.processor);
        return incomplete.length ? { incomplete } : {};
    } catch (error) {
        console.error("[Auth] Delete account error:", error);
        return { error: SETTINGS_MESSAGES.accountDeleteFailed };
    }
}

"use server";

import { getServerUser } from "@/lib/firebase/auth-session";
import { getAdminDb } from "@/lib/firebase/admin";
import { runUserDataPlan } from "@/lib/db/user-data";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { isMintedLoginEmail, validateSignupEmail } from "@/lib/auth/username-email";
import { getClientIp } from "@/lib/shield/client-ip";
import { allowAuthSignupRequest } from "@/lib/shield/rate-limit";
import { verifyTurnstile } from "@/lib/shield/turnstile";
import { forgetIdentity } from "@/lib/identity/forget";
import { getIntervuPg } from "@/lib/pg/pool";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { resolveLegacyUid, APP_INTERVU } from "@/lib/auth/app-tag";
import { ensureAppMembership } from "@/lib/auth/ensure-app-membership";
import { sendWelcomeEmailOnce } from "@/lib/email/welcome";
import { grantWelcomeCredits } from "@/lib/llm/credit-gate";

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

export async function signUp(prevState: any, formData: FormData) {
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
    // without mocking Turnstile/rate-limiting/Firebase Admin.
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

    // 1. Check availability again to be safe
    const { available } = await checkUsernameAvailability(username);
    if (!available) {
        return { error: "Username is already taken" };
    }

    try {
        const adminAuth = await createAdminClient();
        const db = getAdminDb();

        // 2. Create user in Supabase Auth. `email_confirm` is deliberately
        // left false — signup doesn't yet prove control of this address (no
        // verification link is sent), so claiming it confirmed would be an
        // unearned claim nothing in this codebase even reads.
        // `user_metadata.full_name` carries the display name Firebase's
        // `displayName` used to (see getServerUser's displayName mapping).
        const { data, error: createError } = await adminAuth.auth.admin.createUser({
            email,
            password,
            user_metadata: { full_name: username },
        });
        if (createError || !data.user) {
            if (createError?.code === "email_exists") {
                return { error: "Username is already taken" };
            }
            return { error: createError?.message || "Failed to create account" };
        }
        const user = data.user;
        // Brand new account — never a migrated one — but resolveLegacyUid is
        // the one rule for "what id keys this user's Firestore data", so this
        // goes through it too rather than assuming user.id directly.
        const uid = resolveLegacyUid(user);

        // 3. Tag intervu membership. Idempotent and additive — see
        // ensureAppMembership's own doc for why this can't be a DB trigger.
        const { added } = await ensureAppMembership(user.id, APP_INTERVU);

        // 4. Create profile document in Firestore
        try {
            await db.collection("profiles").doc(uid).set({
                username,
                created_at: new Date().toISOString(),
            });
        } catch (profileError: any) {
            console.error("Profile creation error:", profileError);
            // Rollback: Delete the user we just created so they can try again
            await adminAuth.auth.admin.deleteUser(user.id);
            return { error: `Profile setup failed: ${profileError.message}. Please try again.` };
        }

        // This action only ever runs once per account (unlike a login, which
        // can happen many times), so the welcome email + credit grant fire
        // unconditionally here rather than being gated on `added` the way
        // the OAuth callback gates them — see that route's comment.
        if (added) {
            await sendWelcomeEmailOnce(uid, email);
            await grantWelcomeCredits(uid).catch((err) =>
                console.error("[Auth] welcome credit grant failed:", err),
            );
        }

        // Client handles sign-in
        return { success: true };
    } catch (error: any) {
        console.error("[Auth] Sign up error:", error);
        return { error: error.message || "Failed to create account" };
    }
}

export async function signIn(prevState: any, formData: FormData) {
    const username = formData.get("username") as string;
    const password = formData.get("password") as string;

    if (!username || !password) {
        return { error: "Username and password are required" };
    }

    // Supabase sign-in happens client-side (lib/firebase/client-auth.ts's
    // signInWithEmail/signInWithIdentifier) — the @supabase/ssr browser
    // client syncs the resulting session into cookies itself, no server
    // round trip required.
    return { success: true };
}

export async function signOut() {
    const supabase = await createClient();
    await supabase.auth.signOut();

    // Revalidate to clear cached session data
    revalidatePath("/", "layout");

    redirect("/");
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
 * ORDER MATTERS. Firestore first, Auth last. Deleting the Auth user first —
 * as this did — means any later failure strands the remaining documents for
 * good: the account is gone, so nobody can sign in to retry the sweep.
 *
 * Also sweeps the PG identity store (verified-email-follow's `forgetIdentity`,
 * see `docs/specs/2026-08-19-verified-email-follow-design.md` item 7) when
 * the account's email is a real address rather than the synthetic
 * `<username>@intervu.cc` a password signup mints — a minted address was
 * never entered into the email-follow flow, so there is nothing there to
 * find, and running the lookup anyway would just be wasted PG round trips.
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

        // Firestore is keyed by the legacy-resolved `uid` above, but the
        // Supabase auth record itself is keyed by its OWN id — for a
        // migrated user that is never the same string, so it's resolved
        // fresh here rather than reused from `user.uid`.
        const supabase = await createClient();
        const { data: sessionData } = await supabase.auth.getUser();
        if (sessionData.user) {
            const admin = await createAdminClient();
            await admin.auth.admin.deleteUser(sessionData.user.id);
        }

        if (user.email && !isMintedLoginEmail(user.email)) {
            await forgetIdentity(getIntervuPg(), user.email);
        }

        await supabase.auth.signOut();

        return {};
    } catch (error) {
        console.error("[Auth] Delete account error:", error);
        return { error: error instanceof Error ? error.message : "Failed to delete account" };
    }
}

// Password reset is handled entirely by Supabase's native client flow:
//   - request:  client-auth.sendResetEmail(email)  (ForgotPasswordForm + Settings)
//   - complete: client-auth.confirmReset(newPassword), using the recovery
//               session Supabase establishes from the emailed link
//               (ResetPasswordForm)
// The previous server actions only console.log'd the link (no email was ever sent),
// so the entire flow was dead end-to-end. They have been removed — do NOT reintroduce
// a server-side reset path without an actual transactional email integration.

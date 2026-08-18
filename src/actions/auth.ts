"use server";

import { getServerUser, clearSessionCookie } from "@/lib/firebase/auth-session";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { runUserDataPlan } from "@/lib/db/user-data";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { usernameEmail } from "@/lib/auth/username-email";
import { getClientIp } from "@/lib/shield/client-ip";
import { allowAuthSignupRequest } from "@/lib/shield/rate-limit";
import { verifyTurnstile } from "@/lib/shield/turnstile";

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

    const email = usernameEmail(username);

    try {
        const adminAuth = getAdminAuth();
        const db = getAdminDb();

        // 2. Create user in Firebase Auth. `emailVerified` is deliberately
        // omitted (defaults false) — this address is synthesized by
        // `usernameEmail`, not one the user actually supplied and proved
        // control of (see lib/auth/username-email.ts); claiming it verified
        // would be an unearned claim nothing in this codebase even reads.
        const userRecord = await adminAuth.createUser({
            email,
            password,
            displayName: username,
        });

        // 3. Create profile document in Firestore
        try {
            await db.collection("profiles").doc(userRecord.uid).set({
                username,
                created_at: new Date().toISOString(),
            });
        } catch (profileError: any) {
            console.error("Profile creation error:", profileError);
            // Rollback: Delete the user we just created so they can try again
            await adminAuth.deleteUser(userRecord.uid);
            return { error: `Profile setup failed: ${profileError.message}. Please try again.` };
        }

        // Client handles sign-in and session cookie creation
        return { success: true };
    } catch (error: any) {
        console.error("[Auth] Sign up error:", error);
        if (error.code === "auth/email-already-exists") {
            return { error: "Username is already taken" };
        }
        return { error: error.message || "Failed to create account" };
    }
}

export async function signIn(prevState: any, formData: FormData) {
    const username = formData.get("username") as string;
    const password = formData.get("password") as string;

    if (!username || !password) {
        return { error: "Username and password are required" };
    }

    // Firebase Auth sign-in happens client-side.
    // The client will call Firebase signInWithEmailAndPassword,
    // then POST the ID token to /api/auth/session to set the session cookie.
    return { success: true };
}

export async function signOut() {
    await clearSessionCookie();

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

        await getAdminAuth().deleteUser(uid);
        await clearSessionCookie();

        return {};
    } catch (error) {
        console.error("[Auth] Delete account error:", error);
        return { error: error instanceof Error ? error.message : "Failed to delete account" };
    }
}

// Password reset is handled entirely by Firebase's native client flow:
//   - request:  client-auth.sendResetEmail(email)  (ForgotPasswordForm + Settings)
//   - complete: client-auth.confirmReset(oobCode, newPassword)  (ResetPasswordForm)
// The previous server actions only console.log'd the link (no email was ever sent),
// so the entire flow was dead end-to-end. They have been removed — do NOT reintroduce
// a server-side reset path without an actual transactional email integration.

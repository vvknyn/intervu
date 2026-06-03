"use server";

import { getServerUser, clearSessionCookie } from "@/lib/firebase/auth-session";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

function getEmailFromUsername(username: string) {
    return `${username}@intervu.cc`;
}

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

    if (!username || !password) {
        return { error: "Username and password are required" };
    }

    if (username.length < 3) {
        return { error: "Username must be at least 3 characters" };
    }

    // 1. Check availability again to be safe
    const { available } = await checkUsernameAvailability(username);
    if (!available) {
        return { error: "Username is already taken" };
    }

    const email = getEmailFromUsername(username);

    try {
        const adminAuth = getAdminAuth();
        const db = getAdminDb();

        // 2. Create user in Firebase Auth
        const userRecord = await adminAuth.createUser({
            email,
            password,
            displayName: username,
            emailVerified: true,
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
 * Delete the current user's account and all associated data.
 * localStorage must be cleared client-side before calling this.
 */
export async function deleteAccount(): Promise<{ error?: string }> {
    const user = await getServerUser();

    if (!user) {
        return { error: "Unauthorized" };
    }

    try {
        const adminAuth = getAdminAuth();
        const db = getAdminDb();
        const uid = user.uid;

        // Delete user from Firebase Auth
        await adminAuth.deleteUser(uid);

        // Delete all user data from Firestore collections
        const collectionsToDelete = [
            "profiles",
            "stories",
            "sources",
            "applications",
            "tailored_resumes",
            "job_analyses",
            "favorite_questions",
            "interview_prep_cache",
            "feedback",
        ];

        const deletePromises = collectionsToDelete.map(async (collectionName) => {
            if (collectionName === "profiles") {
                // Profile doc ID is the user uid
                await db.collection("profiles").doc(uid).delete();
            } else {
                // Other collections: query for documents belonging to this user
                const snapshot = await db
                    .collection(collectionName)
                    .where("user_id", "==", uid)
                    .get();

                const batch = db.batch();
                snapshot.docs.forEach((doc) => {
                    batch.delete(doc.ref);
                });
                if (!snapshot.empty) {
                    await batch.commit();
                }
            }
        });

        await Promise.all(deletePromises);

        // Clear session cookie
        await clearSessionCookie();

        return {};
    } catch (error: any) {
        console.error("[Auth] Delete account error:", error);
        return { error: error.message };
    }
}

/**
 * Request a password reset email.
 * User provides their username and a real email address where the reset link will be sent.
 * Firebase Admin SDK generates a password reset link, which we would send to the user's real email.
 */
export async function requestPasswordReset(prevState: any, formData: FormData) {
    const username = (formData.get("username") as string)?.trim();
    const email = (formData.get("email") as string)?.trim();

    if (!username || !email) {
        return { error: "Username and email are required" };
    }

    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return { error: "Please enter a valid email address" };
    }

    try {
        const adminAuth = getAdminAuth();
        const db = getAdminDb();

        // Look up user by username in profiles
        const snapshot = await db
            .collection("profiles")
            .where("username", "==", username)
            .get();

        if (snapshot.empty) {
            // Don't reveal whether username exists — still return success
            return { success: true };
        }

        const profileDoc = snapshot.docs[0];
        const uid = profileDoc.id;

        // Get the user's Firebase Auth email (username@intervu.cc)
        const userRecord = await adminAuth.getUser(uid);
        const firebaseEmail = userRecord.email;

        if (!firebaseEmail) {
            return { success: true };
        }

        // Generate a password reset link for the Firebase Auth email
        const headerList = await headers();
        const host = headerList.get("host") || "localhost:3000";
        const protocol = headerList.get("x-forwarded-proto") || "http";
        const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || `${protocol}://${host}`;

        const resetLink = await adminAuth.generatePasswordResetLink(firebaseEmail, {
            url: `${siteUrl}/reset-password`,
        });

        // Store the real email temporarily so we can send the link
        // In production, you'd send this via an email service (e.g., SendGrid, Resend)
        // For now, we store the reset info and the link would be sent to the provided real email
        await db.collection("profiles").doc(uid).update({
            reset_email: email,
            reset_requested_at: new Date().toISOString(),
        });

        // TODO: Send resetLink to `email` via your email service
        // await sendEmail({ to: email, subject: "Password Reset", body: `Reset your password: ${resetLink}` });
        console.log(`[Auth] Password reset link generated for ${username}, should be sent to ${email}`);

        return { success: true };
    } catch (e: any) {
        console.error("[Auth] Password reset request error:", e);
        return { error: "An unexpected error occurred. Please try again." };
    }
}

/**
 * Reset password using the oobCode from Firebase's password reset link.
 * With Firebase, the actual password reset is handled by Firebase's built-in flow,
 * but we keep this server action for any custom reset flow.
 */
export async function resetPassword(prevState: any, formData: FormData) {
    const password = (formData.get("password") as string)?.trim();
    const confirmPassword = (formData.get("confirmPassword") as string)?.trim();
    const oobCode = (formData.get("oobCode") as string)?.trim();

    if (!password || !confirmPassword) {
        return { error: "Both password fields are required" };
    }

    if (password !== confirmPassword) {
        return { error: "Passwords do not match" };
    }

    if (password.length < 6) {
        return { error: "Password must be at least 6 characters" };
    }

    try {
        // If we have a logged-in user (e.g., from settings), use their session
        const user = await getServerUser();

        if (user) {
            const adminAuth = getAdminAuth();
            const db = getAdminDb();

            // Update password via Admin SDK
            await adminAuth.updateUser(user.uid, { password });

            // Clean up any reset email stored on the profile
            await db.collection("profiles").doc(user.uid).update({
                reset_email: null,
                reset_requested_at: null,
            });

            return { success: true };
        }

        // If no session and no oobCode, the reset link flow is handled client-side
        // via Firebase's confirmPasswordReset(oobCode, newPassword)
        if (!oobCode) {
            return { error: "Session expired. Please request a new reset link." };
        }

        // The oobCode-based reset should be handled client-side with Firebase SDK
        // This is a fallback that shouldn't normally be reached
        return { error: "Please complete the password reset from the link in your email." };
    } catch (e: any) {
        console.error("[Auth] Password reset error:", e);
        return { error: "An unexpected error occurred. Please try again." };
    }
}

/**
 * Send a password reset email for the currently logged-in user.
 * The user provides a real email address where the reset link is sent.
 */
export async function requestPasswordResetFromSettings(email: string): Promise<{ error?: string; success?: boolean }> {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return { error: "Please enter a valid email address" };
    }

    try {
        const user = await getServerUser();

        if (!user) {
            return { error: "You must be logged in" };
        }

        const adminAuth = getAdminAuth();
        const db = getAdminDb();

        // Get the profile to verify it exists
        const profileDoc = await db.collection("profiles").doc(user.uid).get();
        if (!profileDoc.exists) {
            return { error: "Profile not found" };
        }

        // Get the user's Firebase Auth email
        const userRecord = await adminAuth.getUser(user.uid);
        const firebaseEmail = userRecord.email;

        if (!firebaseEmail) {
            return { error: "Account email not found" };
        }

        // Generate password reset link
        const headerList = await headers();
        const host = headerList.get("host") || "localhost:3000";
        const protocol = headerList.get("x-forwarded-proto") || "http";
        const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || `${protocol}://${host}`;

        const resetLink = await adminAuth.generatePasswordResetLink(firebaseEmail, {
            url: `${siteUrl}/reset-password`,
        });

        // Store the real email for sending
        await db.collection("profiles").doc(user.uid).update({
            reset_email: email,
            reset_requested_at: new Date().toISOString(),
        });

        // TODO: Send resetLink to `email` via your email service
        // await sendEmail({ to: email, subject: "Password Reset", body: `Reset your password: ${resetLink}` });
        console.log(`[Auth] Password reset link generated for settings reset, should be sent to ${email}`);

        return { success: true };
    } catch (e: any) {
        console.error("[Auth] Settings password reset error:", e);
        return { error: "An unexpected error occurred. Please try again." };
    }
}

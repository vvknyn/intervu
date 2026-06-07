"use server";

import { getServerUser, clearSessionCookie } from "@/lib/firebase/auth-session";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

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

// Password reset is handled entirely by Firebase's native client flow:
//   - request:  client-auth.sendResetEmail(email)  (ForgotPasswordForm + Settings)
//   - complete: client-auth.confirmReset(oobCode, newPassword)  (ResetPasswordForm)
// The previous server actions only console.log'd the link (no email was ever sent),
// so the entire flow was dead end-to-end. They have been removed — do NOT reintroduce
// a server-side reset path without an actual transactional email integration.

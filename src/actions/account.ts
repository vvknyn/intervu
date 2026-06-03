"use server";

import { getServerUser, clearSessionCookie } from "@/lib/firebase/auth-session";
import { getAdminDb, getAdminAuth } from "@/lib/firebase/admin";

/**
 * Delete the current user's account and all associated data.
 * Manually deletes from all collections since Firestore has no CASCADE.
 */
export async function deleteAccount(): Promise<{ error?: string }> {
    try {
        const user = await getServerUser();

        if (!user) {
            return { error: "Unauthorized" };
        }

        const db = getAdminDb();
        const uid = user.uid;

        // Collections where docs are keyed by user_id field
        const userIdCollections = [
            "stories",
            "sources",
            "applications",
            "tailored_resumes",
            "job_analyses",
            "favorite_questions",
            "interview_prep_cache",
            "feedback",
        ];

        // Delete from all collections with user_id field
        const deletionPromises = userIdCollections.map(async (collectionName) => {
            const snapshot = await db
                .collection(collectionName)
                .where("user_id", "==", uid)
                .get();

            if (snapshot.empty) return;

            const batch = db.batch();
            snapshot.docs.forEach((doc) => batch.delete(doc.ref));
            await batch.commit();
        });

        // Delete profiles doc (keyed by uid directly)
        deletionPromises.push(
            db.collection("profiles").doc(uid).delete().then(() => {})
        );

        await Promise.all(deletionPromises);

        // Delete Firebase Auth user
        const auth = getAdminAuth();
        await auth.deleteUser(uid);

        // Clear session cookie
        await clearSessionCookie();

        return {};
    } catch (e: any) {
        console.error("[Account] Delete error:", e);
        return { error: e.message || "Failed to delete account" };
    }
}

/**
 * Export all user data as a JSON object.
 */
export async function exportUserData(): Promise<{ data?: Record<string, any>; error?: string }> {
    try {
        const user = await getServerUser();

        if (!user) {
            return { error: "Unauthorized" };
        }

        const db = getAdminDb();
        const uid = user.uid;

        // Fetch all user data from every collection in parallel
        const [
            profileDoc,
            storiesSnapshot,
            sourcesSnapshot,
            applicationsSnapshot,
            tailoredResumesSnapshot,
            jobAnalysesSnapshot,
            favoriteQuestionsSnapshot,
            cacheSnapshot,
        ] = await Promise.all([
            db.collection("profiles").doc(uid).get(),
            db.collection("stories").where("user_id", "==", uid).get(),
            db.collection("sources").where("user_id", "==", uid).get(),
            db.collection("applications").where("user_id", "==", uid).get(),
            db.collection("tailored_resumes").where("user_id", "==", uid).get(),
            db.collection("job_analyses").where("user_id", "==", uid).get(),
            db.collection("favorite_questions").where("user_id", "==", uid).get(),
            db.collection("interview_prep_cache").where("user_id", "==", uid).get(),
        ]);

        const snapshotToDocs = (snapshot: FirebaseFirestore.QuerySnapshot) =>
            snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

        const exportData = {
            exported_at: new Date().toISOString(),
            user: {
                id: uid,
                email: user.email || null,
            },
            profile: profileDoc.exists ? { id: profileDoc.id, ...profileDoc.data() } : null,
            stories: snapshotToDocs(storiesSnapshot),
            sources: snapshotToDocs(sourcesSnapshot),
            applications: snapshotToDocs(applicationsSnapshot),
            tailored_resumes: snapshotToDocs(tailoredResumesSnapshot),
            job_analyses: snapshotToDocs(jobAnalysesSnapshot),
            favorite_questions: snapshotToDocs(favoriteQuestionsSnapshot),
            interview_prep_cache: snapshotToDocs(cacheSnapshot),
        };

        return { data: exportData };
    } catch (e: any) {
        console.error("[Account] Export error:", e);
        return { error: e.message || "Failed to export data" };
    }
}

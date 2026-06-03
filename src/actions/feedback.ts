"use server";

import { getServerUser } from "@/lib/firebase/auth-session";
import { getAdminDb } from "@/lib/firebase/admin";
import { headers } from "next/headers";

type FeedbackType = "bug" | "feedback" | "other";

export interface FeedbackItem {
    id: string;
    user_id: string;
    type: FeedbackType;
    message: string;
    path: string | null;
    user_agent: string | null;
    created_at: string;
    user_email?: string;
}

export async function submitFeedback({
    type,
    message,
    path,
}: {
    type: FeedbackType;
    message: string;
    path: string;
}) {
    const user = await getServerUser();
    const headersList = await headers();
    const userAgent = headersList.get("user-agent") || "unknown";

    if (!user) {
        return { error: "You must be logged in to submit feedback." };
    }

    try {
        const db = getAdminDb();
        await db.collection("feedback").add({
            user_id: user.uid,
            type,
            message,
            path,
            user_agent: userAgent,
            created_at: new Date().toISOString(),
        });

        return { success: true };
    } catch (error: any) {
        console.error("Error submitting feedback:", error);
        return { error: "Failed to submit feedback. Please try again." };
    }
}

export async function fetchAllFeedback(): Promise<{ data?: FeedbackItem[]; error?: string }> {
    const user = await getServerUser();
    if (!user) return { error: "Unauthorized" };

    try {
        const db = getAdminDb();

        // Verify caller is admin
        const profileDoc = await db.collection("profiles").doc(user.uid).get();
        if (!profileDoc.exists || !profileDoc.data()?.is_admin) {
            return { error: "Unauthorized" };
        }

        // Fetch all feedback, newest first
        const snapshot = await db
            .collection("feedback")
            .orderBy("created_at", "desc")
            .get();

        const data: FeedbackItem[] = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        })) as FeedbackItem[];

        return { data };
    } catch (error: any) {
        console.error("[Feedback] Fetch error:", error);
        return { error: error.message };
    }
}

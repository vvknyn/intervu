"use server";

import { getServerUser } from "@/lib/auth/server-user";
import { getAdminDb } from "@/lib/firebase/admin";
import { revalidatePath } from "next/cache";

export interface InterviewQuestion {
    id: string;
    question: string;
    answer: string;
    tags: string[];
    application_id?: string;
    created_at: string;
}

export async function getInterviewQuestions(applicationId?: string) {
    try {
        const user = await getServerUser();
        if (!user) {
            return { error: "User not authenticated" };
        }

        const db = getAdminDb();
        let query: FirebaseFirestore.Query = db
            .collection("interview_questions")
            .where("user_id", "==", user.uid)
            .orderBy("created_at", "desc");

        if (applicationId) {
            query = query.where("application_id", "==", applicationId);
        }

        const snapshot = await query.get();
        const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as InterviewQuestion[];

        return { data };
    } catch (error: any) {
        console.error("Error fetching questions:", error);
        return { error: "Failed to fetch questions" };
    }
}

export async function deleteInterviewQuestion(id: string) {
    try {
        const user = await getServerUser();
        if (!user) {
            return { error: "User not authenticated" };
        }

        const db = getAdminDb();
        const docRef = db.collection("interview_questions").doc(id);
        const doc = await docRef.get();

        if (!doc.exists || doc.data()?.user_id !== user.uid) {
            return { error: "Question not found" };
        }

        await docRef.delete();

        revalidatePath('/yours');
        return { success: true };
    } catch (error: any) {
        console.error("Error deleting question:", error);
        return { error: error.message };
    }
}

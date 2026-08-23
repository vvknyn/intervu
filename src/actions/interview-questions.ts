"use server";

import { getServerUser } from "@/lib/auth/session";
import { getAdminDb } from "@/lib/firebase/admin";
import { generateGenericJSON } from "@/actions/generate-context";
import { revalidatePath } from "next/cache";

export interface InterviewQuestion {
    id: string;
    question: string;
    answer: string;
    tags: string[];
    application_id?: string;
    created_at: string;
}

export async function addInterviewQuestion(input: {
    question: string;
    applicationId?: string;
}) {
    try {
        const user = await getServerUser();
        if (!user) {
            return { error: "User not authenticated" };
        }

        if (!input.question.trim()) {
            return { error: "Question cannot be empty" };
        }

        // 1. Generate Answer & Tags using LLM
        const prompt = `
      You are an expert interview coach. A candidate was asked the following interview question:
      "${input.question}"

      Please provide:
      1. A high-quality, professional answer to this question. If it's behavioral, use the STAR method. If technical, explain clearly.
      2. A list of 3-5 relevant tags (e.g., "Behavioral", "Leadership", "React", "System Design").

      Return ONLY valid JSON in this format:
      {
        "answer": "The generated answer...",
        "tags": ["tag1", "tag2", "tag3"]
      }
    `;

        const generated = await generateGenericJSON(prompt);

        if (!generated || !generated.answer) {
            return { error: "Failed to generate answer" };
        }

        // 2. Save to Database
        const db = getAdminDb();
        const now = new Date().toISOString();
        const docData = {
            user_id: user.uid,
            application_id: input.applicationId || null,
            question: input.question,
            answer: generated.answer,
            tags: generated.tags || [],
            created_at: now,
        };

        const docRef = await db.collection("interview_questions").add(docData);
        const data = { id: docRef.id, ...docData };

        revalidatePath("/yours");
        revalidatePath(`/yours/${input.applicationId}`);

        return { data };
    } catch (error: any) {
        console.error("Error in addInterviewQuestion:", error);
        return { error: error.message || "An unexpected error occurred" };
    }
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

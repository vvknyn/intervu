"use server";

import { getServerUser } from "@/lib/firebase/auth-session";
import { getAdminDb } from "@/lib/firebase/admin";

export interface FavoriteQuestion {
    id: string;
    user_id: string;
    question_text: string;
    question_category?: string;
    company?: string;
    position?: string;
    round?: string;
    notes?: string;
    created_at: string;
    updated_at: string;
}

export interface CreateFavoriteInput {
    question_text: string;
    question_category?: string;
    company?: string;
    position?: string;
    round?: string;
    notes?: string;
}

/**
 * Fetch all favorite questions for the current user
 */
export async function fetchFavorites() {
    const user = await getServerUser();
    if (!user) {
        return { data: null, error: "Unauthorized" };
    }

    try {
        const db = getAdminDb();
        const snapshot = await db
            .collection("favorite_questions")
            .where("user_id", "==", user.uid)
            .orderBy("created_at", "desc")
            .get();

        const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as FavoriteQuestion[];
        return { data, error: null };
    } catch (error: any) {
        console.error("Error fetching favorites:", error);
        return { data: null, error: error.message };
    }
}

/**
 * Add a question to favorites
 */
export async function addFavorite(input: CreateFavoriteInput) {
    const user = await getServerUser();
    if (!user) {
        return { data: null, error: "Unauthorized" };
    }

    try {
        const db = getAdminDb();

        // Check for duplicate (replaces Postgres unique constraint 23505)
        const existingSnapshot = await db
            .collection("favorite_questions")
            .where("user_id", "==", user.uid)
            .where("question_text", "==", input.question_text)
            .limit(1)
            .get();

        if (!existingSnapshot.empty) {
            return { data: null, error: "Question already in favorites" };
        }

        const now = new Date().toISOString();
        const docData = {
            user_id: user.uid,
            ...input,
            created_at: now,
            updated_at: now,
        };

        const docRef = await db.collection("favorite_questions").add(docData);
        const data = { id: docRef.id, ...docData } as FavoriteQuestion;

        return { data, error: null };
    } catch (error: any) {
        console.error("Error adding favorite:", error);
        return { data: null, error: error.message };
    }
}

/**
 * Remove a question from favorites
 */
export async function removeFavorite(favoriteId: string) {
    const user = await getServerUser();
    if (!user) {
        return { error: "Unauthorized" };
    }

    try {
        const db = getAdminDb();
        const docRef = db.collection("favorite_questions").doc(favoriteId);
        const doc = await docRef.get();

        if (!doc.exists || doc.data()?.user_id !== user.uid) {
            return { error: "Favorite not found" };
        }

        await docRef.delete();
        return { error: null };
    } catch (error: any) {
        console.error("Error removing favorite:", error);
        return { error: error.message };
    }
}

/**
 * Update notes for a favorite question
 */
export async function updateFavoriteNotes(favoriteId: string, notes: string) {
    const user = await getServerUser();
    if (!user) {
        return { error: "Unauthorized" };
    }

    try {
        const db = getAdminDb();
        const docRef = db.collection("favorite_questions").doc(favoriteId);
        const doc = await docRef.get();

        if (!doc.exists || doc.data()?.user_id !== user.uid) {
            return { error: "Favorite not found" };
        }

        await docRef.update({
            notes,
            updated_at: new Date().toISOString(),
        });

        return { error: null };
    } catch (error: any) {
        console.error("Error updating favorite notes:", error);
        return { error: error.message };
    }
}

/**
 * Batch-fetch all favorited question texts for the current user.
 * Returns a map of question_text -> favorite_id for O(1) lookups.
 */
export async function fetchFavoritedQuestionTexts(): Promise<{ data: Record<string, string>; error: string | null }> {
    const user = await getServerUser();
    if (!user) {
        return { data: {}, error: "Unauthorized" };
    }

    try {
        const db = getAdminDb();
        const snapshot = await db
            .collection("favorite_questions")
            .where("user_id", "==", user.uid)
            .get();

        const map: Record<string, string> = {};
        for (const doc of snapshot.docs) {
            const data = doc.data();
            map[data.question_text] = doc.id;
        }

        return { data: map, error: null };
    } catch (error: any) {
        console.error("Error fetching favorited texts:", error);
        return { data: {}, error: error.message };
    }
}

/**
 * Check if a question is favorited
 */
export async function isFavorited(questionText: string, company?: string, position?: string, round?: string) {
    const user = await getServerUser();
    if (!user) {
        return { data: false, error: "Unauthorized" };
    }

    try {
        const db = getAdminDb();
        let query: FirebaseFirestore.Query = db
            .collection("favorite_questions")
            .where("user_id", "==", user.uid)
            .where("question_text", "==", questionText);

        if (company) query = query.where("company", "==", company);
        if (position) query = query.where("position", "==", position);
        if (round) query = query.where("round", "==", round);

        const snapshot = await query.limit(1).get();

        return { data: !snapshot.empty, error: null };
    } catch (error: any) {
        console.error("Error checking favorite status:", error);
        return { data: false, error: error.message };
    }
}

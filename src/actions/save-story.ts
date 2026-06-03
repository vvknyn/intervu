"use server";

import { getServerUser } from "@/lib/firebase/auth-session";
import { getAdminDb } from "@/lib/firebase/admin";
import { StarStory } from "@/types";

export async function saveStories(stories: StarStory[]) {
    if (!stories || !Array.isArray(stories)) return { error: "Invalid stories data" };

    try {
        const user = await getServerUser();
        if (!user) return { error: "Unauthorized" };

        console.log("[Server Action] Saving stories individually...", stories.length);

        const db = getAdminDb();
        const batch = db.batch();
        const collectionRef = db.collection("stories");

        const rowsToInsert = stories.map(story => ({
            title: story.title,
            // We store the full object in content to preserve all fields including ID and deleted status
            content: JSON.stringify(story),
            user_id: user.uid,
            created_at: new Date().toISOString(),
        }));

        const docRefs: FirebaseFirestore.DocumentReference[] = [];
        for (const row of rowsToInsert) {
            const docRef = collectionRef.doc();
            batch.set(docRef, row);
            docRefs.push(docRef);
        }

        await batch.commit();

        const data = rowsToInsert.map((row, i) => ({
            id: docRefs[i].id,
            ...row,
        }));

        console.log("[Server Action] Saved rows:", data.length);
        return { success: true, data };

    } catch (e: unknown) {
        console.error("[Server Action] Unexpected Error in saveStories:", e);
        return { error: (e as Error).message };
    }
}

export async function fetchStories() {
    try {
        const user = await getServerUser();
        if (!user) return { error: "Unauthorized" };

        const db = getAdminDb();
        const snapshot = await db
            .collection("stories")
            .where("user_id", "==", user.uid)
            .orderBy("created_at", "asc") // Oldest first, so newer overwrites older
            .get();

        const data = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
        })) as { id: string; content: string; created_at: string }[];

        if (!data || data.length === 0) {
            console.log("[Server Action] No data returned from fetchStories");
            return { data: "[]" };
        }

        console.log(`[Server Action] Fetched ${data.length} rows.`);

        const storyMap = new Map<string, StarStory>();

        data.forEach(row => {
            if (!row.content) {
                console.warn("[Server Action] Row missing content:", row);
                return;
            }
            try {
                const parsed = JSON.parse(row.content);

                // Handle legacy format (array of stories)
                if (Array.isArray(parsed)) {
                    parsed.forEach((s: StarStory) => {
                        if (s.id) {
                            storyMap.set(s.id, s);
                        } else {
                            console.warn("Legacy story missing ID:", s);
                        }
                    });
                }
                // Handle new format (single story object)
                else if (parsed.id) {
                    storyMap.set(parsed.id, parsed);
                } else {
                    console.warn("[Server Action] Parsed object missing ID:", parsed);
                }
            } catch (e) {
                // If JSON parsing fails, treat it as legacy text content and wrap it in a partial story
                if (row.content && typeof row.content === 'string' && row.content.trim().length > 0) {
                    const fallbackId = row.id;
                    if (!storyMap.has(fallbackId)) {
                        // Advanced Legacy Parsing: Try to split by "Q:" and "A:"
                        const rawText = row.content;
                        const qaRegex = /Q:\s*(.*?)\s*\n\s*A:\s*([\s\S]*?)(?=\n\s*Q:|$)/g;
                        let match;
                        let index = 0;
                        let foundMatches = false;

                        while ((match = qaRegex.exec(rawText)) !== null) {
                            foundMatches = true;
                            const question = match[1].trim();
                            const answer = match[2].trim();
                            const generatedId = `${fallbackId}-${index}`;

                            storyMap.set(generatedId, {
                                id: generatedId,
                                title: question.length > 50 ? question.substring(0, 50) + "..." : question,
                                situation: `Question: ${question}\n\nAnswer: ${answer}`,
                                task: "",
                                action: "",
                                result: "",
                            });
                            index++;
                        }

                        // Fallback to single blob if no Q/A structure found but text exists
                        if (!foundMatches) {
                            storyMap.set(fallbackId, {
                                id: fallbackId,
                                title: "Restored Legacy Content",
                                situation: row.content,
                                task: "Please refactor this content into the appropriate fields.",
                                action: "",
                                result: "",
                            });
                        }
                        console.log(`[Server Action] Recovered ${index} legacy stories from row ${row.id}`);
                    }
                } else {
                    console.warn("[Server Action] Failed to parse story row:", row.content?.substring(0, 50) + "...", e);
                }
            }
        });

        console.log(`[Server Action] Processed ${storyMap.size} unique stories.`);

        // Convert map to array and filter out deleted ones
        const validStories = Array.from(storyMap.values()).filter(s => !s.deleted);

        return { data: JSON.stringify(validStories) };

    } catch (e: unknown) {
        console.error("[Server Action] Unexpected Error in fetchStories:", e);
        return { error: (e as Error).message };
    }
}

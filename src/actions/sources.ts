"use server";

import { getServerUser } from "@/lib/auth/server-user";
import { getAdminDb } from "@/lib/firebase/admin";
import { SourceItem } from "@/types";
import { checkContentSafety, checkContentSafetyStrict } from "@/lib/url-safety";
import { fetchUrlContent as fetchUrlCore, discoverLinks as discoverLinksCore } from "@/actions/fetch-url";

export async function fetchSources(): Promise<{ data?: SourceItem[]; error?: string }> {
    try {
        const user = await getServerUser();
        if (!user) return { error: "Unauthorized" };

        const db = getAdminDb();
        const snapshot = await db
            .collection("sources")
            .where("user_id", "==", user.uid)
            .orderBy("created_at", "desc")
            .get();

        const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as SourceItem[];
        return { data };
    } catch (e: unknown) {
        console.error("Fetch Sources Error:", e);
        return { error: (e as Error).message || "Failed to fetch sources." };
    }
}

export async function saveSource(source: Omit<SourceItem, 'id' | 'created_at' | 'user_id'>): Promise<{ data?: SourceItem; error?: string }> {
    try {
        const user = await getServerUser();
        if (!user) return { error: "Unauthorized" };

        // Normalize newlines in content to prevent issues
        const content = source.content.replace(/\r\n/g, '\n');

        // Content safety check - strict for public sources
        const visibility = source.visibility || 'private';
        if (visibility === 'public') {
            const safetyCheck = checkContentSafetyStrict(content);
            if (!safetyCheck.safe) return { error: safetyCheck.reason };
        } else {
            const safetyCheck = checkContentSafety(content);
            if (!safetyCheck.safe) return { error: safetyCheck.reason };
        }

        const db = getAdminDb();
        const now = new Date().toISOString();
        const docData = {
            ...source,
            content,
            visibility,
            user_id: user.uid,
            created_at: now,
        };

        const docRef = await db.collection("sources").add(docData);
        const data = { id: docRef.id, ...docData } as SourceItem;

        return { data };
    } catch (e: unknown) {
        console.error("Save Source Error:", e);
        return { error: (e as Error).message || "Failed to save source." };
    }
}

export async function deleteSource(id: string): Promise<{ error?: string }> {
    try {
        const user = await getServerUser();
        if (!user) return { error: "Unauthorized" };

        const db = getAdminDb();
        const docRef = db.collection("sources").doc(id);
        const doc = await docRef.get();

        if (!doc.exists || doc.data()?.user_id !== user.uid) {
            return { error: "Source not found" };
        }

        await docRef.delete();
        return {};
    } catch (e: unknown) {
        console.error("Delete Source Error:", e);
        return { error: (e as Error).message || "Failed to delete source." };
    }
}

export async function fetchUrlContent(url: string): Promise<{ text?: string; title?: string; error?: string }> {
    const { data, title, error } = await fetchUrlCore(url);
    return { text: data, title, error };
}

export async function discoverLinks(url: string): Promise<{ links: { url: string; title: string }[]; error?: string }> {
    return discoverLinksCore(url);
}

export async function fetchPublicSources(search?: string): Promise<{ data?: Omit<SourceItem, 'user_id'>[]; error?: string }> {
    try {
        const db = getAdminDb();
        const snapshot = await db
            .collection("sources")
            .where("visibility", "==", "public")
            .orderBy("created_at", "desc")
            .limit(50)
            .get();

        let results = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                type: data.type,
                title: data.title,
                content: data.content,
                created_at: data.created_at,
                visibility: data.visibility,
            } as Omit<SourceItem, 'user_id'>;
        });

        // Firestore can't do ilike, so filter in memory
        if (search && search.trim()) {
            const term = search.trim().toLowerCase();
            results = results.filter(
                item =>
                    (item.title && item.title.toLowerCase().includes(term)) ||
                    (item.content && item.content.toLowerCase().includes(term))
            );
        }

        return { data: results };
    } catch (e: unknown) {
        console.error("Fetch Public Sources Error:", e);
        return { error: (e as Error).message || "Failed to fetch public sources." };
    }
}

export async function addPublicSourceToCollection(sourceId: string): Promise<{ data?: SourceItem; error?: string }> {
    try {
        const user = await getServerUser();
        if (!user) return { error: "Unauthorized" };

        const db = getAdminDb();

        // Fetch the public source
        const publicDoc = await db.collection("sources").doc(sourceId).get();

        if (!publicDoc.exists || publicDoc.data()?.visibility !== "public") {
            return { error: "Source not found or not public" };
        }

        const publicSource = publicDoc.data()!;

        // Copy as a private source for this user
        const now = new Date().toISOString();
        const docData = {
            type: publicSource.type,
            title: publicSource.title,
            content: publicSource.content,
            visibility: 'private',
            user_id: user.uid,
            created_at: now,
        };

        const docRef = await db.collection("sources").add(docData);
        const data = { id: docRef.id, ...docData } as SourceItem;

        return { data };
    } catch (e: unknown) {
        console.error("Add Public Source Error:", e);
        return { error: (e as Error).message || "Failed to add source." };
    }
}

/**
 * Server actions for interview prep cache management
 */

"use server";

import { getServerUser } from "@/lib/auth/session";
import { getAdminDb } from "@/lib/firebase/admin";
import { CachedInterviewData } from "@/lib/interview-cache";

const CACHE_DURATION_HOURS = 24;

export interface ServerCachedData {
    id: string;
    cacheKey: string;
    company: string;
    position: string;
    round: string;
    jd_fingerprint?: string;
    reconData?: any;
    matchData?: any;
    questionsData?: any;
    reverseData?: any;
    technicalData?: any;
    codingChallenges?: any[];
    systemDesignData?: any;
    resumeCompanies?: string[];
    hasResumeContext: boolean;
    createdAt: string;
    expiresAt: string;
}

/**
 * Fetch cached data from server
 */
export async function fetchServerCache(cacheKey: string): Promise<{ data?: CachedInterviewData; error?: string }> {
    try {
        const user = await getServerUser();

        if (!user) {
            return { error: "Unauthorized" };
        }

        const db = getAdminDb();
        const snapshot = await db
            .collection("interview_prep_cache")
            .where("user_id", "==", user.uid)
            .where("cache_key", "==", cacheKey)
            .where("expires_at", ">", new Date().toISOString())
            .get();

        if (snapshot.empty) {
            console.log("[ServerCache] Cache miss:", cacheKey);
            return { data: undefined };
        }

        const data = snapshot.docs[0].data();

        console.log("[ServerCache] Cache hit:", cacheKey);

        return {
            data: {
                cacheKey: data.cache_key,
                company: data.company,
                position: data.position,
                round: data.round,
                jdFingerprint: data.jd_fingerprint,
                hasResumeContext: data.has_resume_context,
                createdAt: new Date(data.created_at).getTime(),
                expiresAt: new Date(data.expires_at).getTime(),
                reconData: data.recon_data,
                matchData: data.match_data,
                questionsData: data.questions_data,
                reverseData: data.reverse_data,
                technicalData: data.technical_data,
                codingChallenges: (() => {
                    const raw = data.coding_challenge;
                    return Array.isArray(raw) ? raw : raw ? [raw] : [];
                })(),
                systemDesignData: data.system_design_data,
                resumeCompanies: data.resume_companies || []
            }
        };
    } catch (e: any) {
        console.error("[ServerCache] Fetch error:", e);
        return { error: e.message };
    }
}

/**
 * Save data to server cache
 */
export async function saveServerCache(cachedData: CachedInterviewData): Promise<{ error?: string }> {
    try {
        const user = await getServerUser();

        if (!user) {
            return { error: "Unauthorized" };
        }

        const db = getAdminDb();
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + CACHE_DURATION_HOURS);

        const cacheDoc = {
            user_id: user.uid,
            cache_key: cachedData.cacheKey,
            company: cachedData.company,
            position: cachedData.position,
            round: cachedData.round,
            ...(cachedData.jdFingerprint !== undefined
                ? { jd_fingerprint: cachedData.jdFingerprint }
                : {}),
            recon_data: cachedData.reconData,
            match_data: cachedData.matchData,
            questions_data: cachedData.questionsData,
            reverse_data: cachedData.reverseData,
            technical_data: cachedData.technicalData,
            coding_challenge: cachedData.codingChallenges,
            system_design_data: cachedData.systemDesignData,
            resume_companies: cachedData.resumeCompanies || [],
            has_resume_context: cachedData.hasResumeContext,
            expires_at: expiresAt.toISOString(),
        };

        // Check for existing doc with same user_id + cache_key
        const snapshot = await db
            .collection("interview_prep_cache")
            .where("user_id", "==", user.uid)
            .where("cache_key", "==", cachedData.cacheKey)
            .get();

        if (!snapshot.empty) {
            // Update existing doc
            await snapshot.docs[0].ref.update(cacheDoc);
        } else {
            // Create new doc
            await db.collection("interview_prep_cache").add({
                ...cacheDoc,
                created_at: new Date().toISOString(),
            });
        }

        console.log("[ServerCache] Data saved:", cachedData.cacheKey, "expires:", expiresAt);
        return {};
    } catch (e: any) {
        console.error("[ServerCache] Save exception:", e);
        return { error: e.message };
    }
}

/**
 * Clear specific cache entry
 */
export async function clearServerCache(cacheKey: string): Promise<{ error?: string }> {
    try {
        const user = await getServerUser();

        if (!user) {
            return { error: "Unauthorized" };
        }

        const db = getAdminDb();
        const snapshot = await db
            .collection("interview_prep_cache")
            .where("user_id", "==", user.uid)
            .where("cache_key", "==", cacheKey)
            .get();

        const batch = db.batch();
        snapshot.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();

        console.log("[ServerCache] Cleared:", cacheKey);
        return {};
    } catch (e: any) {
        console.error("[ServerCache] Clear exception:", e);
        return { error: e.message };
    }
}

/**
 * Clear all cache entries for current user
 */
export async function clearAllServerCache(): Promise<{ error?: string }> {
    try {
        const user = await getServerUser();

        if (!user) {
            return { error: "Unauthorized" };
        }

        const db = getAdminDb();
        const snapshot = await db
            .collection("interview_prep_cache")
            .where("user_id", "==", user.uid)
            .get();

        const batch = db.batch();
        snapshot.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();

        console.log("[ServerCache] Cleared all cache for user");
        return {};
    } catch (e: any) {
        console.error("[ServerCache] Clear all exception:", e);
        return { error: e.message };
    }
}

/**
 * Clean up expired cache entries (can be called periodically)
 */
export async function cleanupExpiredCache(): Promise<{ deleted?: number; error?: string }> {
    try {
        const db = getAdminDb();
        const snapshot = await db
            .collection("interview_prep_cache")
            .where("expires_at", "<", new Date().toISOString())
            .get();

        if (snapshot.empty) {
            console.log("[ServerCache] No expired entries to clean up");
            return { deleted: 0 };
        }

        const batch = db.batch();
        snapshot.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();

        console.log("[ServerCache] Expired entries cleaned up:", snapshot.size);
        return { deleted: snapshot.size };
    } catch (e: any) {
        console.error("[ServerCache] Cleanup exception:", e);
        return { error: e.message };
    }
}

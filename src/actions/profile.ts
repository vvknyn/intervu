"use server";

import { getServerUser } from "@/lib/auth/session";
import { getAdminDb } from "@/lib/firebase/admin";
import { decryptKeys } from "@/lib/encryption";

export async function fetchProfile() {
    try {
        const user = await getServerUser();

        if (!user) {
            return { error: "Unauthorized" };
        }

        const db = getAdminDb();
        const doc = await db.collection("profiles").doc(user.uid).get();

        if (!doc.exists) {
            // Don't error out, just return null so we can fall back to default if needed
            return { data: null };
        }

        const docData = doc.data();
        const data: Record<string, any> = {
            resume_text: docData?.resume_text ?? null,
            is_admin: docData?.is_admin ?? false,
        };

        return { data };
    } catch (e: any) {
        return { error: e.message };
    }
}

export async function updateResume(resumeText: string) {
    try {
        const user = await getServerUser();

        if (!user) {
            return { error: "Unauthorized" };
        }

        console.log("[Profile] Updating resume for:", user.uid);

        const db = getAdminDb();
        await db.collection("profiles").doc(user.uid).update({
            resume_text: resumeText,
        });

        return { success: true };
    } catch (e: any) {
        console.error("[Profile] Update Error:", e);
        return { error: e.message };
    }
}

/**
 * LEGACY BYOK HONORING (2026-08-08): resolves a user's own OpenRouter/Groq
 * key + model preference, previously set via a now-deleted Settings UI (see
 * ModelSettings.tsx, removed in this commit — BYOK is no longer offered to
 * new users on this non-technical-ICP product). This READ path stays so
 * anyone who already stored a key keeps getting unlimited, unmetered AI
 * (credit-gate.ts's isBYOK bypass) instead of a rug-pull. There is no
 * write path anymore — `custom_api_key` / `preferred_provider` /
 * `preferred_model` are read-only remnants of the old flow. Removable once
 * stored `custom_api_key` fields are confirmed empty across all profiles.
 * Returns null if the user has not configured their own key (caller falls
 * back to the app default). Decryption happens server-side only — the key
 * never leaves the server.
 */
export async function getUserLLMConfig(): Promise<{ provider: string; apiKey: string; model?: string } | null> {
    try {
        const user = await getServerUser();
        if (!user) return null;

        const db = getAdminDb();
        const doc = await db.collection("profiles").doc(user.uid).get();
        if (!doc.exists) return null;

        const d = doc.data() || {};
        let keys: Record<string, string | undefined> = {};
        if (d.custom_api_key) {
            try {
                const parsed = JSON.parse(d.custom_api_key);
                if (parsed && typeof parsed === "object") {
                    keys = decryptKeys(parsed) as Record<string, string | undefined>;
                }
            } catch {
                // legacy single-key string — ignore for BYOK resolution
            }
        }

        const preferred = d.preferred_provider as string | undefined;
        const provider = preferred && keys[preferred]
            ? preferred
            : (keys.openrouter ? "openrouter" : keys.groq ? "groq" : undefined);

        if (!provider || !keys[provider]) return null;
        return { provider, apiKey: keys[provider]!, model: d.preferred_model || undefined };
    } catch (e: any) {
        console.warn("[Profile] getUserLLMConfig failed:", e.message);
        return null;
    }
}

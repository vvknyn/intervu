"use server";

import { getServerUser } from "@/lib/firebase/auth-session";
import { getAdminDb } from "@/lib/firebase/admin";
import { encryptKeys, decryptKeys } from "@/lib/encryption";
import { validate, saveProviderApiKeySchema, setPreferredProviderSchema } from "@/lib/validation";
import { providerKeyPresence } from "@/lib/llm/byok";
import { AVAILABLE_MODELS, type Provider } from "@/lib/llm/models";

export async function fetchProfile() {
    try {
        const user = await getServerUser();

        if (!user) {
            return { error: "Unauthorized" };
        }

        const db = getAdminDb();
        const doc = await db.collection("profiles").doc(user.uid).get();

        if (!doc.exists) {
            return { data: null };
        }

        const docData = doc.data();
        const customApiKey = docData?.custom_api_key as string | undefined;

        return {
            data: {
                resume_text: docData?.resume_text ?? null,
                is_admin: docData?.is_admin ?? false,
                preferred_provider: (docData?.preferred_provider as Provider | null) ?? null,
                provider_keys: providerKeyPresence(customApiKey),
            },
        };
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

async function readUserByokProfile(uid: string): Promise<{
    keys: Record<string, string | undefined>;
    preferred?: string;
    preferredModel?: string;
} | null> {
    const db = getAdminDb();
    const doc = await db.collection("profiles").doc(uid).get();
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

    return {
        keys,
        preferred: d.preferred_provider as string | undefined,
        preferredModel: d.preferred_model as string | undefined,
    };
}

/** Decrypted key for one BYOK provider, regardless of preferred_provider. */
export async function getUserProviderKey(provider: Provider): Promise<string | null> {
    try {
        const user = await getServerUser();
        if (!user) return null;

        const profile = await readUserByokProfile(user.uid);
        const key = profile?.keys[provider];
        return key?.trim() ? key : null;
    } catch (e: any) {
        console.warn("[Profile] getUserProviderKey failed:", e.message);
        return null;
    }
}

/**
 * Resolve the signed-in user's preferred provider + decrypted key + model.
 * Returns null when no BYOK key is stored (callers must not fall back to shared keys).
 * Decryption happens server-side only — the key never leaves the server.
 */
export async function getUserLLMConfig(): Promise<{ provider: string; apiKey: string; model?: string } | null> {
    try {
        const user = await getServerUser();
        if (!user) return null;

        const profile = await readUserByokProfile(user.uid);
        if (!profile) return null;

        const { keys, preferred, preferredModel } = profile;
        const provider = preferred && keys[preferred]
            ? preferred
            : (keys.openrouter ? "openrouter" : keys.groq ? "groq" : undefined);

        if (!provider || !keys[provider]) return null;
        return { provider, apiKey: keys[provider]!, model: preferredModel || undefined };
    } catch (e: any) {
        console.warn("[Profile] getUserLLMConfig failed:", e.message);
        return null;
    }
}

async function readDecryptedKeys(uid: string): Promise<Record<string, string | undefined>> {
    const db = getAdminDb();
    const doc = await db.collection("profiles").doc(uid).get();
    const existing = doc.exists ? doc.data()?.custom_api_key : undefined;
    if (!existing) return {};
    try {
        const parsed = JSON.parse(existing);
        if (parsed && typeof parsed === "object") return decryptKeys(parsed);
    } catch {
        // legacy single-key string — start fresh
    }
    return {};
}

/**
 * Set or clear a single provider's API key, merging with existing keys.
 * Plaintext never round-trips through the client after save.
 */
export async function saveProviderApiKey(provider: string, key: string) {
    try {
        const user = await getServerUser();
        if (!user) return { error: "Unauthorized" };

        const parsed = validate(saveProviderApiKeySchema, { provider, key });
        if (!parsed.ok) return { error: parsed.error };
        ({ provider, key } = parsed.data);

        const current = await readDecryptedKeys(user.uid);
        const trimmed = key.trim();
        if (trimmed) current[provider] = trimmed;
        else delete current[provider];

        const db = getAdminDb();
        await db.collection("profiles").doc(user.uid).update({
            custom_api_key: JSON.stringify(encryptKeys(current)),
        });
        return { success: true };
    } catch (e: any) {
        console.error("[Profile] saveProviderApiKey error:", e);
        return { error: e.message };
    }
}

/** Persist which BYOK provider (and its default model) to use for AI actions. */
export async function setPreferredProvider(provider: string) {
    try {
        const user = await getServerUser();
        if (!user) return { error: "Unauthorized" };

        const parsed = validate(setPreferredProviderSchema, { provider });
        if (!parsed.ok) return { error: parsed.error };

        const models = AVAILABLE_MODELS[parsed.data.provider];
        const db = getAdminDb();
        await db.collection("profiles").doc(user.uid).update({
            preferred_provider: parsed.data.provider,
            preferred_model: models[0]?.id,
        });
        return { success: true };
    } catch (e: any) {
        console.error("[Profile] setPreferredProvider error:", e);
        return { error: e.message };
    }
}

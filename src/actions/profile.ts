"use server";

import { getServerUser } from "@/lib/firebase/auth-session";
import { getAdminDb } from "@/lib/firebase/admin";
import { encryptKeys, decryptKeys } from "@/lib/encryption";
import { validate, saveProviderApiKeySchema } from "@/lib/validation";

export interface ProviderApiKeys {
    openrouter?: string;
    groq?: string;
}

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
            custom_api_key: docData?.custom_api_key ?? null,
            preferred_provider: docData?.preferred_provider ?? null,
            preferred_model: docData?.preferred_model ?? null,
            is_admin: docData?.is_admin ?? false,
        };

        // Parse custom_api_key if it's JSON (contains provider keys)
        if (data.custom_api_key) {
            try {
                const parsed = JSON.parse(data.custom_api_key);
                // If it's a valid JSON object with provider keys, attach it
                if (parsed && typeof parsed === 'object') {
                    data.provider_api_keys = parsed;
                }
            } catch {
                // Not JSON, that's okay - it's a legacy single key
            }
        }

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

export async function updateModelSettings(apiKey: string, model: string) {
    try {
        const user = await getServerUser();

        if (!user) {
            return { error: "Unauthorized" };
        }

        console.log("[Profile] Updating model settings for:", user.uid);

        const db = getAdminDb();
        await db.collection("profiles").doc(user.uid).update({
            preferred_model: model,
            custom_api_key: apiKey,
        });

        // Revalidate cache to ensure new settings take effect everywhere
        try {
            const { revalidatePath } = await import("next/cache");
            revalidatePath("/", "layout");
        } catch (e) {
            console.warn("Failed to revalidate cache:", e);
        }

        return { success: true };
    } catch (e: any) {
        console.error("[Profile] Settings Update Error:", e);
        return { error: e.message };
    }
}

/**
 * Save API keys for all providers.
 * Encrypts key values before storing (provider names stay plaintext).
 */
export async function saveProviderApiKeys(keys: ProviderApiKeys) {
    try {
        const user = await getServerUser();

        if (!user) {
            return { error: "Unauthorized" };
        }

        console.log("[Profile] Saving provider API keys for:", user.uid);

        // Encrypt API key values before storing
        const encryptedKeys = encryptKeys(keys as Record<string, string | undefined>);

        const db = getAdminDb();
        await db.collection("profiles").doc(user.uid).update({
            custom_api_key: JSON.stringify(encryptedKeys),
        });

        console.log("[Profile] API keys saved successfully");
        return { success: true };
    } catch (e: any) {
        console.error("[Profile] API Keys Save Error:", e);
        return { error: e.message };
    }
}

/**
 * Load API keys for all providers
 */
export async function loadProviderApiKeys(): Promise<{ data?: ProviderApiKeys; error?: string }> {
    try {
        const user = await getServerUser();

        if (!user) {
            return { error: "Unauthorized" };
        }

        const db = getAdminDb();
        const doc = await db.collection("profiles").doc(user.uid).get();

        if (!doc.exists) {
            return { data: {} };
        }

        const docData = doc.data();
        const customApiKey = docData?.custom_api_key;

        // Parse custom_api_key if it's JSON, then decrypt values
        if (customApiKey) {
            try {
                const parsed = JSON.parse(customApiKey);
                if (parsed && typeof parsed === 'object') {
                    // Decrypt API key values (handles both encrypted and plaintext for backwards compat)
                    const decrypted = decryptKeys(parsed);
                    return { data: decrypted as ProviderApiKeys };
                }
            } catch {
                // Not JSON, return empty
            }
        }

        return { data: {} };
    } catch (e: any) {
        return { error: e.message };
    }
}

/**
 * Persist which provider + model the user wants to use (does NOT touch stored keys).
 */
export async function updateModelPreference(provider: string, model: string) {
    try {
        const user = await getServerUser();
        if (!user) return { error: "Unauthorized" };

        const db = getAdminDb();
        await db.collection("profiles").doc(user.uid).update({
            preferred_provider: provider,
            preferred_model: model,
        });
        return { success: true };
    } catch (e: any) {
        console.error("[Profile] Model preference update error:", e);
        return { error: e.message };
    }
}

/**
 * Resolve the signed-in user's preferred provider + DECRYPTED key + model in a single read.
 * Returns null if the user has not configured their own key (caller falls back to the app default).
 * Decryption happens server-side only — the key never leaves the server.
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

/**
 * Set (or clear, if key is empty) a single provider's API key, merging with existing keys.
 * Runs entirely server-side: existing keys are decrypted, merged, and re-encrypted, so other
 * providers' keys are preserved and plaintext never round-trips through the client.
 */
export async function saveProviderApiKey(provider: string, key: string) {
    try {
        const user = await getServerUser();
        if (!user) return { error: "Unauthorized" };

        // Reject unknown providers / oversize keys before decrypt+merge+re-encrypt.
        const parsed = validate(saveProviderApiKeySchema, { provider, key });
        if (!parsed.ok) return { error: parsed.error };
        ({ provider, key } = parsed.data);

        const db = getAdminDb();
        const doc = await db.collection("profiles").doc(user.uid).get();

        let current: Record<string, string | undefined> = {};
        const existing = doc.exists ? doc.data()?.custom_api_key : undefined;
        if (existing) {
            try {
                const parsed = JSON.parse(existing);
                if (parsed && typeof parsed === "object") current = decryptKeys(parsed);
            } catch {
                // legacy single-key string — start fresh
            }
        }

        const trimmed = key.trim();
        if (trimmed) current[provider] = trimmed;
        else delete current[provider];

        await db.collection("profiles").doc(user.uid).update({
            custom_api_key: JSON.stringify(encryptKeys(current)),
        });
        return { success: true };
    } catch (e: any) {
        console.error("[Profile] saveProviderApiKey error:", e);
        return { error: e.message };
    }
}

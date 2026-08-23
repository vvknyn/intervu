/**
 * Server-only LLM config resolution. Free tier is BYOK-only: non-admin users
 * without a saved key never receive the app-funded OpenRouter/Groq keys.
 * Admins may still use shared keys for ops/debugging.
 */
import { getUserLLMConfig, getUserProviderKey } from "@/actions/profile";
import { getServerUser } from "@/lib/firebase/auth-session";
import {
    AUTH_REQUIRED,
    AUTH_REQUIRED_MESSAGE,
    BYOK_REQUIRED,
    BYOK_REQUIRED_MESSAGE,
    isAdminUser,
} from "@/lib/llm/credit-gate";
import { AVAILABLE_MODELS, DEFAULT_MODEL, type Provider } from "@/lib/llm/models";
import { ProviderConfig } from "@/lib/llm/types";

function sharedOpenRouterKey(): string {
    return process.env.OPENROUTER_API_KEY || "";
}

function sharedGroqKey(): string {
    return process.env.GROQ_API_KEY || "";
}

export type ResolvedLLMConfig = { provider: string; apiKey: string; model: string };

/** Resolve provider config for text/JSON generation actions. */
export async function resolveLLMConfig(override?: Partial<ProviderConfig>): Promise<ResolvedLLMConfig> {
    if (override?.apiKey && override?.provider) {
        return {
            apiKey: override.apiKey,
            provider: override.provider,
            model: override.model || DEFAULT_MODEL,
        };
    }

    const userCfg = await getUserLLMConfig();
    if (userCfg) {
        const fallbackModel = AVAILABLE_MODELS[userCfg.provider as Provider]?.[0]?.id || DEFAULT_MODEL;
        return {
            apiKey: userCfg.apiKey,
            provider: userCfg.provider,
            model: override?.model || userCfg.model || fallbackModel,
        };
    }

    const user = await getServerUser();
    if (!user) {
        throw new Error(`${AUTH_REQUIRED}: ${AUTH_REQUIRED_MESSAGE}`);
    }

    // Admins may use the shared OpenRouter key for debugging.
    if (await isAdminUser(user)) {
        const apiKey = sharedOpenRouterKey();
        if (!apiKey) {
            throw new Error("Missing OPENROUTER_API_KEY environment variable.");
        }
        return { apiKey, provider: "openrouter", model: override?.model || DEFAULT_MODEL };
    }

    throw new Error(`${BYOK_REQUIRED}: ${BYOK_REQUIRED_MESSAGE}`);
}

/** Groq Whisper transcription — requires a stored Groq BYOK key, or admin shared key. */
export async function resolveGroqTranscriptionKey(): Promise<string> {
    const groqKey = await getUserProviderKey("groq");
    if (groqKey) return groqKey;

    const user = await getServerUser();
    if (!user) {
        throw new Error(`${AUTH_REQUIRED}: Sign in to use voice transcription.`);
    }

    if (await isAdminUser(user)) {
        const key = sharedGroqKey();
        if (!key) throw new Error("Server configuration error: GROQ_API_KEY missing");
        return key;
    }

    throw new Error(`${BYOK_REQUIRED}: ${BYOK_REQUIRED_MESSAGE}`);
}

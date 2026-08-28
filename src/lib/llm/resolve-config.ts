/**
 * Server-only LLM config resolution. Every signed-in user runs on the app's
 * own OpenRouter/Groq keys — the app funds the AI. Sign-in is still required:
 * the shared key is never spent on anonymous traffic. The auth gate (and the
 * separate `/admin` exemption) lives in `credit-gate.ts`, not here; this
 * module only answers "which provider and key".
 */
import { getServerUser } from "@/lib/auth/server-user";
import { AUTH_REQUIRED, AUTH_REQUIRED_MESSAGE } from "@/lib/llm/credit-gate";
import { DEFAULT_MODEL } from "@/lib/llm/models";
import { ProviderConfig } from "@/lib/llm/types";

function sharedOpenRouterKey(): string {
    return process.env.OPENROUTER_API_KEY || "";
}

function sharedGroqKey(): string {
    return process.env.GROQ_API_KEY || "";
}

/** Throws AUTH_REQUIRED unless someone is signed in. The one place that rule
 *  is expressed for key resolution — both resolvers below call it. */
async function requireSignedIn(message: string): Promise<void> {
    const user = await getServerUser();
    if (!user) {
        throw new Error(`${AUTH_REQUIRED}: ${message}`);
    }
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

    await requireSignedIn(AUTH_REQUIRED_MESSAGE);

    const apiKey = sharedOpenRouterKey();
    if (!apiKey) {
        throw new Error("Missing OPENROUTER_API_KEY environment variable.");
    }
    return { apiKey, provider: "openrouter", model: override?.model || DEFAULT_MODEL };
}

/** Groq Whisper transcription — runs on the app's shared Groq key. */
export async function resolveGroqTranscriptionKey(): Promise<string> {
    await requireSignedIn("Sign in to use voice transcription.");

    const key = sharedGroqKey();
    if (!key) throw new Error("Server configuration error: GROQ_API_KEY missing");
    return key;
}

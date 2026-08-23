import type { Provider } from "@/lib/llm/models";

export const BYOK_PROVIDERS = ["openrouter", "groq"] as const satisfies readonly Provider[];

export type ByokProvider = (typeof BYOK_PROVIDERS)[number];

export type ProviderKeyPresence = Record<ByokProvider, boolean>;

const EMPTY_PRESENCE: ProviderKeyPresence = { openrouter: false, groq: false };

/** Detect which providers have a stored key without decrypting values. */
export function providerKeyPresence(customApiKey: string | null | undefined): ProviderKeyPresence {
    if (!customApiKey) return { ...EMPTY_PRESENCE };
    try {
        const parsed = JSON.parse(customApiKey) as Record<string, unknown>;
        if (!parsed || typeof parsed !== "object") return { ...EMPTY_PRESENCE };
        return {
            openrouter: hasStoredKey(parsed.openrouter),
            groq: hasStoredKey(parsed.groq),
        };
    } catch {
        return { ...EMPTY_PRESENCE };
    }
}

function hasStoredKey(value: unknown): boolean {
    return typeof value === "string" && value.trim().length > 0;
}

export const KEY_PLACEHOLDERS: Record<ByokProvider, string> = {
    openrouter: "sk-or-…",
    groq: "gsk_…",
};

export type ByokOnboardingStep = { title: string; body?: string; href?: string };

export type ByokOnboarding = {
    steps: ByokOnboardingStep[];
    keysUrl: string;
    docsUrl?: string;
    signupUrl?: string;
};

/** SSOT for BYOK onboarding copy and external URLs. */
export const BYOK_ONBOARDING: Record<ByokProvider, ByokOnboarding> = {
    openrouter: {
        signupUrl: "https://openrouter.ai",
        keysUrl: "https://openrouter.ai/keys",
        docsUrl: "https://openrouter.ai/docs",
        steps: [
            { title: "Create an account or sign in", href: "https://openrouter.ai" },
            { title: "Open Keys", href: "https://openrouter.ai/keys" },
            { title: "Create key" },
            { title: "Copy your key", body: "Starts with sk-or-…" },
            { title: "Paste it below" },
        ],
    },
    groq: {
        signupUrl: "https://console.groq.com",
        keysUrl: "https://console.groq.com/keys",
        docsUrl: "https://console.groq.com/docs",
        steps: [
            { title: "Sign in at Groq Console", href: "https://console.groq.com" },
            { title: "Open API Keys", href: "https://console.groq.com/keys" },
            { title: "Create key" },
            { title: "Copy your key", body: "Starts with gsk_…" },
            { title: "Paste it below" },
        ],
    },
};

/** @deprecated Prefer BYOK_ONBOARDING[provider].keysUrl */
export const KEY_HELP_URLS: Record<ByokProvider, string> = {
    openrouter: BYOK_ONBOARDING.openrouter.keysUrl,
    groq: BYOK_ONBOARDING.groq.keysUrl,
};

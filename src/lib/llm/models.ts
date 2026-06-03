export const DEFAULT_MODEL = "qwen/qwen3-vl-235b-a22b-thinking";
export const DEFAULT_PROVIDER = "openrouter";

export const AVAILABLE_MODELS = {
    openrouter: [
        { id: "qwen/qwen3-vl-235b-a22b-thinking", name: "DeepSeek V3", description: "Fast, capable, no rate limits (~$0.14/M tokens)", category: "Paid" as const },
    ],
} as const;

export type Provider = keyof typeof AVAILABLE_MODELS;
export type Model = { id: string; name: string; description: string; category: "Free" | "Paid" };

export const PROVIDERS = [
    { id: "openrouter", name: "OpenRouter", description: "Free models via OpenRouter" }
] as const;

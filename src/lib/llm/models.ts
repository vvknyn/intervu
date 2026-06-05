export const DEFAULT_PROVIDER = "openrouter";
// App-provided default. A stable, cheap, JSON-reliable model on the shared OpenRouter key.
// (Replaced the free `owl-alpha` stealth model, which proved unstable — started 400-ing.)
export const DEFAULT_MODEL = "deepseek/deepseek-v4-flash";

export const AVAILABLE_MODELS = {
    openrouter: [
        { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash", description: "Default — fast, very cheap, 1M context", category: "Paid" as const },
        { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro", description: "Higher quality, pricier", category: "Paid" as const },
        { id: "openai/gpt-4o-mini", name: "GPT-4o mini", description: "Fast & cheap, reliable JSON", category: "Paid" as const },
        { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash", description: "Very fast, low cost", category: "Paid" as const },
        { id: "anthropic/claude-3.5-haiku", name: "Claude 3.5 Haiku", description: "Fast, high quality", category: "Paid" as const },
    ],
    groq: [
        { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B", description: "Versatile, very fast", category: "Free" as const },
        { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B", description: "Fastest, lightweight", category: "Free" as const },
        { id: "gemma2-9b-it", name: "Gemma2 9B", description: "Lightweight", category: "Free" as const },
    ],
} as const;

export type Provider = keyof typeof AVAILABLE_MODELS;
export type Model = { id: string; name: string; description: string; category: "Free" | "Paid" };

export const PROVIDERS = [
    { id: "openrouter", name: "OpenRouter", description: "Default model included — or add your own key" },
    { id: "groq", name: "Groq", description: "Bring your own free Groq key — fastest inference" },
] as const;

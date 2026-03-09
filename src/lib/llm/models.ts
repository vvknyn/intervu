export const AVAILABLE_MODELS = {
    groq: [
        { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B", description: "Recommended for most tasks", category: "Free" as const },
        { id: "llama3-8b-8192", name: "Llama 3 8B", description: "Fast & Efficient", category: "Free" as const },
        { id: "mixtral-8x7b-32768", name: "Mixtral 8x7B", description: "Balanced performance", category: "Free" as const },
        { id: "gemma2-9b-it", name: "Gemma 2 9B", description: "Google's open model", category: "Free" as const },
    ],
    gemini: [
        { id: "gemini-2.0-flash-exp", name: "Gemini 2.0 Flash", description: "Newest & fastest", category: "Free" as const },
        { id: "gemini-1.5-flash-latest", name: "Gemini 1.5 Flash", description: "Efficient & capable", category: "Free" as const },
        { id: "gemini-1.5-pro-latest", name: "Gemini 1.5 Pro", description: "Complex reasoning", category: "Free" as const },
    ],
    openai: [
        { id: "gpt-4o", name: "GPT-4o", description: "Most capable model", category: "Paid" as const },
        { id: "gpt-4o-mini", name: "GPT-4o Mini", description: "Cost-effective", category: "Paid" as const },
        { id: "gpt-3.5-turbo", name: "GPT-3.5 Turbo", description: "Legacy model", category: "Paid" as const },
    ],
} as const;

export type Provider = keyof typeof AVAILABLE_MODELS;
export type Model = { id: string; name: string; description: string; category: "Free" | "Paid" };

export const PROVIDERS = [
    { id: "groq", name: "Groq", description: "Fastest open-source models" },
    { id: "gemini", name: "Google Gemini", description: "Large context window" },
    { id: "openai", name: "OpenAI", description: "Standard for reasoning" }
] as const;

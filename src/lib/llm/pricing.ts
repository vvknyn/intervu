import type { Provider } from "./models";

export const MODEL_PRICING: Record<string, { inputPer1kTokens: number; outputPer1kTokens: number }> = {
    // Groq (free tier)
    "llama-3.3-70b-versatile": { inputPer1kTokens: 0, outputPer1kTokens: 0 },
    "llama3-8b-8192": { inputPer1kTokens: 0, outputPer1kTokens: 0 },
    "mixtral-8x7b-32768": { inputPer1kTokens: 0, outputPer1kTokens: 0 },
    "gemma2-9b-it": { inputPer1kTokens: 0, outputPer1kTokens: 0 },
    // Gemini (free tier)
    "gemini-2.0-flash-exp": { inputPer1kTokens: 0, outputPer1kTokens: 0 },
    "gemini-1.5-flash-latest": { inputPer1kTokens: 0, outputPer1kTokens: 0 },
    "gemini-1.5-pro-latest": { inputPer1kTokens: 0, outputPer1kTokens: 0 },
    // OpenAI (paid)
    "gpt-4o": { inputPer1kTokens: 0.005, outputPer1kTokens: 0.015 },
    "gpt-4o-mini": { inputPer1kTokens: 0.00015, outputPer1kTokens: 0.0006 },
    "gpt-3.5-turbo": { inputPer1kTokens: 0.0005, outputPer1kTokens: 0.0015 },
};

export const PROVIDER_TIER: Record<Provider, "free" | "paid"> = {
    groq: "free",
    gemini: "free",
    openai: "paid",
};

export function estimateSessionCost(
    modelId: string,
    inputTokens: number,
    outputTokens: number
): number | null {
    const pricing = MODEL_PRICING[modelId];
    if (!pricing) return null;
    if (pricing.inputPer1kTokens === 0 && pricing.outputPer1kTokens === 0) return null;
    return (inputTokens / 1000) * pricing.inputPer1kTokens + (outputTokens / 1000) * pricing.outputPer1kTokens;
}

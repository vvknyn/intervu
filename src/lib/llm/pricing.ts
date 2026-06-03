import type { Provider } from "./models";

export const MODEL_PRICING: Record<string, { inputPer1kTokens: number; outputPer1kTokens: number }> = {
    // OpenRouter (free tier)
    "qwen/qwen3-vl-235b-a22b-thinking": { inputPer1kTokens: 0.00014, outputPer1kTokens: 0.00028 },
};

export const PROVIDER_TIER: Record<Provider, "free" | "paid"> = {
    openrouter: "free",
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

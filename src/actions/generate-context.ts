"use server";

import { ProviderFactory } from "@/lib/llm/providers";
import { AUTH_REQUIRED } from "@/lib/llm/credit-gate";
import { resolveLLMConfig } from "@/lib/llm/resolve-config";
import { ProviderConfig } from "@/lib/llm/types";
import { resolveModelLadder, runLadder, type LadderRung } from "@/lib/llm/model-ladder";
import { liveRungs } from "@/lib/llm/live-rungs";
import { FREE_LADDER } from "@/lib/llm/models";
import { stripProviderPrefix } from "@/lib/llm/strip-provider-prefix";

const getConfig = (override?: Partial<ProviderConfig>) => resolveLLMConfig(override);

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** A provider-key fault is always the app's OWN shared key now — there is no
 *  user-supplied key left to fix — so this copy owns the failure rather than
 *  sending the reader to a Settings page that no longer has a key field. */
const SHARED_KEY_FAULT_MESSAGE = "AI is temporarily unavailable — that's on our side, not yours. Please try again shortly.";

const formatError = (e: any) => {
    console.error("Generation Error:", e);
    const msg = e?.message || String(e) || "";

    // Hard block from the auth gate must reach the client VERBATIM so it can
    // recognize the prefix (see Section C client handling). Do NOT run it through
    // the prefix-stripping cleanup below, which would eat "AUTH_REQUIRED:".
    if (msg.startsWith(AUTH_REQUIRED)) {
        return { error: msg };
    }

    const lowerMsg = msg.toLowerCase();

    let errorMessage = "An unexpected error occurred.";

    // Check for specific error patterns
    if (lowerMsg.includes("timeout") || lowerMsg.includes("timed out")) {
        errorMessage = "Request timed out. The AI service may be slow. Please try again or switch to a different provider.";
    } else if (lowerMsg.includes("429") || lowerMsg.includes("rate limit") || lowerMsg.includes("too many requests")) {
        errorMessage = "Rate limit exceeded. Please wait a moment and try again, or switch to a different AI provider.";
    } else if (lowerMsg.includes("401") || lowerMsg.includes("unauthorized") || lowerMsg.includes("invalid") && lowerMsg.includes("key")) {
        errorMessage = SHARED_KEY_FAULT_MESSAGE;
    } else if (lowerMsg.includes("quota") || lowerMsg.includes("resource_exhausted")) {
        errorMessage = "The AI service hit its usage limit. Please try again shortly.";
    } else if (lowerMsg.includes("missing api key") || lowerMsg.includes("api key is required") || lowerMsg.includes("missing openrouter_api_key")) {
        errorMessage = SHARED_KEY_FAULT_MESSAGE;
    } else if (lowerMsg.includes("content") && (lowerMsg.includes("blocked") || lowerMsg.includes("safety"))) {
        errorMessage = "Content was blocked by the AI's safety filters. Please try a different query.";
    } else if (lowerMsg.includes("network") || lowerMsg.includes("econnrefused") || lowerMsg.includes("fetch failed")) {
        errorMessage = "Network error. Please check your internet connection and try again.";
    } else if (lowerMsg.includes("not found") || lowerMsg.includes("model_not_found") || lowerMsg.includes("does not exist")) {
        errorMessage = "The selected AI model isn't available right now. Please try again.";
    } else if (msg && msg.length > 0) {
        // Clean up the error message for display
        errorMessage = stripProviderPrefix(msg);
        // Truncate long error messages
        if (errorMessage.length > 200) {
            errorMessage = errorMessage.substring(0, 200) + "...";
        }
    }

    return { error: errorMessage };
};

// Regex to extract JSON from markdown or noisy output
const JSON_REPAIR_REGEX = /\{(?:[^{}]|\{(?:[^{}]|{[^{}]*})*\})*\}/;

const repairJSON = (text: string) => {
    try {
        // First try standard parse
        return JSON.parse(text);
    } catch {
        // Attempt 1: Strip Markdown Code Blocks
        const cleanText = text.replace(/```json/gi, "").replace(/```/g, "").trim();
        try {
            return JSON.parse(cleanText);
        } catch {
            // Attempt 2: Extract JSON object syntax using Regex
            const match = text.match(JSON_REPAIR_REGEX);
            if (match) {
                try {
                    return JSON.parse(match[0]);
                } catch {
                    return null;
                }
            }
            return null;
        }
    }
};

export const fetchJSON = async (
    prompt: string,
    label: string,
    configOverride?: Partial<ProviderConfig>,
    feature: string = "generic_json",
) => {
    // Resolved ONCE and reused. `getConfig` hits the auth session (and throws
    // AUTH_REQUIRED for a signed-out caller — the only gate left now that
    // credits are gone), so re-resolving per attempt cost a round-trip per
    // retry — and a ladder needs one stable config whose model it can vary
    // per rung anyway.
    const baseConfig = await getConfig(configOverride);

    // Every generation walks the free rungs first (see FREE_LADDER) — this is
    // the seam that makes that true for all ~15 entry points above rather than
    // for whichever ones remembered to opt in. Two callers still skip them: one
    // that named its own model (the override picks THE model, not a starting
    // point) and Groq, handled inside resolveModelLadder by provider check.
    const rungs = await liveRungs(resolveModelLadder(baseConfig, FREE_LADDER, Boolean(configOverride?.model)));
    const traceId = crypto.randomUUID();

    // Helper for timeout
    const withTimeout = (promise: Promise<any>, ms: number, label: string) => {
        return Promise.race([
            promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error(`[Timeout] ${label} timed out after ${ms}ms`)), ms))
        ]);
    };

    const attemptFetch = async (rung: LadderRung, retryCount: number = 0): Promise<any> => {
        try {
            const config = { ...baseConfig, model: rung.model };
            const provider = ProviderFactory.getProvider(config.provider, config.apiKey, config.model);

            console.log(`[DEBUG] Fetching ${label} with ${config.provider}:${config.model}...`);

            // Anchor the model's date reasoning to the real current date. Without this,
            // the model falls back to its training-cutoff notion of "now" — e.g. flagging
            // a recently-started role as "in the future", or under-counting years of
            // experience. This is the single seam every JSON prompt in the app routes
            // through (fetchJSON), so fixing it here covers all callers, not just resume
            // parsing — do not re-inject a date line at individual call sites.
            const todayLine = `Today's date is ${new Date().toISOString().slice(0, 10)}. Use it as "now" for any date reasoning (e.g. years of experience, or whether a role/date is past, current, or future).`;

            // Per-rung timeout (provider handles its own rate limiting). A free
            // rung gets less patience than the paid tail — see model-ladder.ts.
            const response = await withTimeout(
                provider.generate({
                    system: `You are an expert technical interviewer and career coach. Return ONLY valid JSON. ${todayLine}`,
                    prompt: prompt + "\n\nCRITICAL: Return ONLY valid JSON. No markdown formatting.",
                    json: true,
                    timeoutMs: rung.timeoutMs,
                    maxRetries: 1,
                    analytics: {
                        feature,
                        traceId,
                        isFallback: rung.isFallback,
                    },
                }),
                rung.timeoutMs,
                label
            );

            if (response.error) {
                // Check if it's a daily limit error - don't retry
                if (response.error.includes('daily') || response.error.includes('TPD') || response.error.includes('tomorrow')) {
                    throw new Error(response.error);
                }
                throw new Error(response.error);
            }

            let parsed = repairJSON(response.text || "{}");

            if (!parsed) {
                console.warn(`[DEBUG] JSON parse failed for ${label}, attempting repair...`);
                // Try to extract JSON from the response without making another API call
                const jsonMatch = (response.text || "").match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    try {
                        parsed = JSON.parse(jsonMatch[0]);
                    } catch {
                        // Fall through to retry
                    }
                }

                // Only re-prompt the SAME model for a malformed-JSON failure,
                // and only on the rung that has to answer. On a free rung the
                // next rung is the better retry — a different model is more
                // likely to produce valid JSON than the one that just didn't.
                if (!parsed && retryCount < 1 && rung.isFallback) {
                    await delay(1000);
                    const retryResponse = await withTimeout(
                        provider.generate({
                            system: `You output invalid JSON last time. Output purely raw JSON key-value pairs. ${todayLine}`,
                            prompt: prompt,
                            json: true,
                            timeoutMs: Math.min(30_000, rung.timeoutMs),
                            maxRetries: 1,
                            analytics: {
                                feature,
                                traceId,
                                isFallback: rung.isFallback,
                            },
                        }),
                        Math.min(30_000, rung.timeoutMs),
                        `${label} (Correction)`
                    );
                    parsed = repairJSON(retryResponse.text || "{}");
                }
            }

            if (!parsed) throw new Error("Failed to parse JSON response.");
            return parsed;

        } catch (e: any) {
            // Don't retry for daily limits or auth errors
            const errorMsg = e.message?.toLowerCase() || '';
            if (errorMsg.includes('daily') || errorMsg.includes('tpd') ||
                errorMsg.includes('tomorrow') || errorMsg.includes('unauthorized') ||
                errorMsg.includes('invalid') && errorMsg.includes('key')) {
                throw e;
            }

            // Retry once for other transient errors — but only on the rung that
            // has to answer. Waiting 2s to re-ask a rate-limited free model is
            // pure latency; the ladder's next rung is the real retry.
            if (retryCount < 1 && rung.isFallback) {
                console.warn(`[DEBUG] Error fetching ${label}, retrying (${retryCount + 1}/1)...`, e.message);
                await delay(2000); // Wait 2 seconds before retry
                return attemptFetch(rung, retryCount + 1);
            }
            throw e;
        }
    };

    return runLadder(
        rungs,
        (rung) => attemptFetch(rung),
        (rung, error) =>
            console.warn(
                `[DEBUG] ${label}: rung ${rung.model} failed, falling through —`,
                error instanceof Error ? error.message : error,
            ),
    );
};



export async function generateGenericJSON(
    prompt: string,
    configOverride?: Partial<ProviderConfig>,
    feature: string = "generic_json",
): Promise<any> {
    try {
        return await fetchJSON(prompt, "Generic JSON", configOverride, feature);
    } catch (e: any) {
        console.error("Generic JSON Error:", e);
        // Propagate the error message so callers can display it to the user
        const msg = e?.message || String(e) || "";
        return { error: formatError(e).error };
    }
}


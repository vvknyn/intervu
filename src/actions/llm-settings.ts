"use server";

import { ProviderFactory } from "@/lib/llm/providers";

/**
 * Validate a user-supplied provider key by making a tiny live call.
 * Runs server-side so the key is never exposed beyond the request.
 */
export async function validateProviderKey(
    provider: string,
    key: string
): Promise<{ valid: boolean; error?: string }> {
    if (!key || !key.trim()) {
        return { valid: false, error: "Enter a key first." };
    }
    return ProviderFactory.validateApiKey(provider, key.trim());
}

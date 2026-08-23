"use server";

import { ProviderFactory } from "@/lib/llm/providers";
import { validate, validateProviderKeySchema } from "@/lib/validation";

/** Validate a user-supplied provider key with a tiny live call (server-side only). */
export async function validateProviderKey(
    provider: string,
    key: string,
): Promise<{ valid: boolean; error?: string }> {
    const parsed = validate(validateProviderKeySchema, { provider, key });
    if (!parsed.ok) return { valid: false, error: parsed.error };
    return ProviderFactory.validateApiKey(parsed.data.provider, parsed.data.key);
}

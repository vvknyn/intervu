"use server";

export interface CheckUsageResult {
    provider: string;
    status: 'ok' | 'warning' | 'error' | 'unknown';
    message?: string;
}

/**
 * Usage checking is not needed — the app uses a server-side OpenRouter API key.
 */
export async function checkAllUsage(_apiKeys: Record<string, string | undefined>): Promise<CheckUsageResult[]> {
    return [{ provider: 'openrouter', status: 'ok', message: 'Using server-side API key' }];
}

export async function checkProviderUsage(
    provider: string,
    _apiKey: string
): Promise<CheckUsageResult> {
    return { provider, status: 'ok', message: 'Using server-side API key' };
}

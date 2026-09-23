
export interface LLMAnalyticsContext {
    feature: string;
    traceId: string;
    distinctId: string;
    isFallback?: boolean;
}

export interface LLMRequest {
    system?: string;
    prompt: string;
    json?: boolean;
    /** Per-call timeout; defaults to 60s in the provider. */
    timeoutMs?: number;
    /** Provider-level retries; defaults to 3. Ladder callers pass 1. */
    maxRetries?: number;
    analytics?: LLMAnalyticsContext;
}

export interface LLMResponse {
    text: string;
    error?: string;
    modelUsed?: string;
}

export interface LLMProvider {
    generate(request: LLMRequest): Promise<LLMResponse>;
}

export interface ProviderConfig {
    provider: string;
    apiKey: string;
    model: string;
}

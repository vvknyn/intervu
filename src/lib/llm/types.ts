
export interface LLMRequest {
    system?: string;
    prompt: string;
    json?: boolean;
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

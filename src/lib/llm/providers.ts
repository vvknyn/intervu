
import { LLMProvider, LLMRequest, LLMResponse } from './types';
import OpenAI from 'openai';

const DEFAULT_TIMEOUT_MS = 60000;

export enum LLMErrorCode {
    TIMEOUT = 'TIMEOUT',
    RATE_LIMIT = 'RATE_LIMIT',
    INVALID_KEY = 'INVALID_KEY',
    QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
    MODEL_NOT_FOUND = 'MODEL_NOT_FOUND',
    CONTENT_BLOCKED = 'CONTENT_BLOCKED',
    NETWORK_ERROR = 'NETWORK_ERROR',
    PROVIDER_ERROR = 'PROVIDER_ERROR',
    UNKNOWN = 'UNKNOWN'
}

export interface LLMErrorInfo {
    code: LLMErrorCode;
    message: string;
    provider: string;
    model?: string;
    retryable: boolean;
    suggestModelSwitch: boolean;
}

function createTimeoutPromise(ms: number, provider: string): Promise<never> {
    return new Promise((_, reject) => {
        setTimeout(() => {
            reject(new Error(`[${provider}] Request timed out after ${ms / 1000}s.`));
        }, ms);
    });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, provider: string): Promise<T> {
    return Promise.race([promise, createTimeoutPromise(timeoutMs, provider)]);
}

function categorizeError(error: any, provider: string, model?: string): LLMErrorInfo {
    const message = error?.message || String(error);
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes('timeout') || lowerMessage.includes('timed out')) {
        return { code: LLMErrorCode.TIMEOUT, message: `Request timed out. Please try again.`, provider, model, retryable: true, suggestModelSwitch: false };
    }
    if (lowerMessage.includes('429') || lowerMessage.includes('rate limit') || lowerMessage.includes('too many requests')) {
        return { code: LLMErrorCode.RATE_LIMIT, message: `Rate limit reached. Please wait a moment and try again.`, provider, model, retryable: true, suggestModelSwitch: false };
    }
    if (lowerMessage.includes('401') || lowerMessage.includes('unauthorized') || (lowerMessage.includes('invalid') && lowerMessage.includes('key'))) {
        return { code: LLMErrorCode.INVALID_KEY, message: `Invalid API key. Please check your configuration.`, provider, model, retryable: false, suggestModelSwitch: false };
    }
    if (lowerMessage.includes('quota') || lowerMessage.includes('resource_exhausted')) {
        return { code: LLMErrorCode.QUOTA_EXCEEDED, message: `Quota exceeded. Please wait for reset.`, provider, model, retryable: false, suggestModelSwitch: false };
    }
    if (lowerMessage.includes('network') || lowerMessage.includes('econnrefused') || lowerMessage.includes('fetch failed')) {
        return { code: LLMErrorCode.NETWORK_ERROR, message: `Network error. Please check your internet connection.`, provider, model, retryable: true, suggestModelSwitch: false };
    }
    if (lowerMessage.includes('content') && (lowerMessage.includes('blocked') || lowerMessage.includes('safety'))) {
        return { code: LLMErrorCode.CONTENT_BLOCKED, message: `Content was blocked by safety filters. Please try rephrasing.`, provider, model, retryable: false, suggestModelSwitch: false };
    }
    return { code: LLMErrorCode.PROVIDER_ERROR, message: `Error: ${message}`, provider, model, retryable: true, suggestModelSwitch: false };
}

/**
 * OpenRouter provider — uses OpenAI-compatible API at openrouter.ai
 */
export class OpenRouterProvider implements LLMProvider {
    private client: OpenAI;
    private model: string;
    private static lastRequestTime: number = 0;
    private static minRequestInterval: number = 500;

    constructor(apiKey: string, model: string = 'qwen/qwen3-vl-235b-a22b-thinking') {
        if (!apiKey || apiKey.trim() === '') {
            throw new Error('OpenRouter API key is required');
        }
        this.client = new OpenAI({
            apiKey,
            baseURL: 'https://openrouter.ai/api/v1',
            defaultHeaders: {
                'HTTP-Referer': 'https://intervu.cc',
                'X-Title': 'Intervu',
            },
        });
        this.model = model;
    }

    private async waitForRateLimit(): Promise<void> {
        const now = Date.now();
        const timeSinceLastRequest = now - OpenRouterProvider.lastRequestTime;
        if (timeSinceLastRequest < OpenRouterProvider.minRequestInterval) {
            await new Promise(resolve => setTimeout(resolve, OpenRouterProvider.minRequestInterval - timeSinceLastRequest));
        }
        OpenRouterProvider.lastRequestTime = Date.now();
    }

    async generate(request: LLMRequest): Promise<LLMResponse> {
        const maxRetries = 3;
        let lastError: any = null;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                await this.waitForRateLimit();
                console.log(`[OpenRouter] Generating with model: ${this.model}${attempt > 0 ? ` (retry ${attempt})` : ''}`);

                const completionPromise = this.client.chat.completions.create({
                    messages: [
                        { role: 'system', content: request.system || 'You are a helpful assistant.' },
                        { role: 'user', content: request.prompt }
                    ],
                    model: this.model,
                    response_format: request.json ? { type: 'json_object' } : undefined,
                });

                const completion = await withTimeout(completionPromise, DEFAULT_TIMEOUT_MS, 'OpenRouter');
                let text = completion.choices[0]?.message?.content || "";

                if (!text || text.trim() === '') {
                    return { text: "", error: "Empty response received. Please try again." };
                }

                // Strip <think>...</think> blocks from thinking models
                text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

                console.log(`[OpenRouter] Generated ${text.length} characters`);
                return { text };

            } catch (e: any) {
                lastError = e;
                console.error(`[OpenRouter] Error (attempt ${attempt + 1}/${maxRetries}):`, e.message);
                const errorInfo = categorizeError(e, 'OpenRouter', this.model);

                if (errorInfo.code === LLMErrorCode.RATE_LIMIT && attempt < maxRetries - 1) {
                    const waitTime = (attempt + 1) * 3000;
                    console.log(`[OpenRouter] Rate limited, waiting ${waitTime}ms...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    continue;
                }

                if (!errorInfo.retryable || attempt >= maxRetries - 1) {
                    return { text: "", error: errorInfo.message };
                }

                await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 2000));
            }
        }

        const errorInfo = categorizeError(lastError, 'OpenRouter', this.model);
        return { text: "", error: errorInfo.message };
    }
}

export class ProviderFactory {
    static getProvider(provider: string, apiKey: string, model?: string): LLMProvider {
        if (!apiKey || apiKey.trim() === '') {
            throw new Error('Missing API key. Please check your configuration.');
        }
        return new OpenRouterProvider(apiKey, model);
    }

    static async validateApiKey(provider: string, apiKey: string): Promise<{ valid: boolean; error?: string }> {
        try {
            const llmProvider = this.getProvider(provider, apiKey);
            const response = await llmProvider.generate({ prompt: 'Reply with just "ok"', json: false });
            if (response.error) return { valid: false, error: response.error };
            return { valid: true };
        } catch (e: any) {
            return { valid: false, error: e.message || 'Failed to validate API key' };
        }
    }
}

export type { LLMErrorInfo as ErrorInfo };


import { LLMProvider, LLMRequest, LLMResponse } from './types';
import { GROQ_DEFAULT_MODEL } from './models';
import OpenAI from 'openai';

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 3;

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

    if (error?.status === 402 || lowerMessage.includes('insufficient credit') || lowerMessage.includes('add more using')) {
        return { code: LLMErrorCode.QUOTA_EXCEEDED, message: `AI is temporarily out of credits on our end. Please try again in a bit.`, provider, model, retryable: false, suggestModelSwitch: true };
    }

    if (lowerMessage.includes('timeout') || lowerMessage.includes('timed out')) {
        // Non-retryable: retrying a timed-out call just re-incurs the full timeout
        // (the old 3x retry turned one 60s timeout into ~180s of hanging). Fail fast;
        // the user can re-trigger, and prep generation degrades per-section (allSettled).
        return { code: LLMErrorCode.TIMEOUT, message: `Request timed out. Please try again.`, provider, model, retryable: false, suggestModelSwitch: false };
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
const DEFAULT_MAX_TOKENS = 4000;

/**
 * Shared base for OpenAI-compatible providers (OpenRouter, Groq).
 * Owns rate-limiting, timeout, retries, and error handling so the
 * concrete providers only declare their base URL / headers / default model.
 */
abstract class OpenAICompatibleProvider implements LLMProvider {
    protected client: OpenAI;
    protected model: string;
    protected providerName: string;
    private static lastRequestTime: number = 0;
    private static readonly minRequestInterval: number = 500;

    constructor(providerName: string, apiKey: string, model: string, baseURL: string, headers?: Record<string, string>) {
        if (!apiKey || apiKey.trim() === '') {
            throw new Error(`${providerName} API key is required`);
        }
        this.providerName = providerName;
        this.model = model;
        this.client = new OpenAI({ apiKey, baseURL, defaultHeaders: headers });
    }

    private async waitForRateLimit(): Promise<void> {
        const now = Date.now();
        const elapsed = now - OpenAICompatibleProvider.lastRequestTime;
        if (elapsed < OpenAICompatibleProvider.minRequestInterval) {
            await new Promise(resolve => setTimeout(resolve, OpenAICompatibleProvider.minRequestInterval - elapsed));
        }
        OpenAICompatibleProvider.lastRequestTime = Date.now();
    }

    async generate(request: LLMRequest): Promise<LLMResponse> {
        const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        const maxRetries = request.maxRetries ?? DEFAULT_MAX_RETRIES;
        let lastError: any = null;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                await this.waitForRateLimit();
                console.log(`[${this.providerName}] Generating with model: ${this.model}${attempt > 0 ? ` (retry ${attempt})` : ''}`);

                const completionPromise = this.client.chat.completions.create({
                    messages: [
                        { role: 'system', content: request.system || 'You are a helpful assistant.' },
                        { role: 'user', content: request.prompt }
                    ],
                    model: this.model,
                    max_tokens: DEFAULT_MAX_TOKENS,
                    response_format: request.json ? { type: 'json_object' } : undefined,
                });

                const completion = await withTimeout(completionPromise, timeoutMs, this.providerName);
                let text = completion.choices[0]?.message?.content || "";

                if (!text || text.trim() === '') {
                    return { text: "", error: "Empty response received. Please try again." };
                }

                // Strip <think>...</think> blocks from thinking models
                text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

                console.log(`[${this.providerName}] Generated ${text.length} characters`);
                return { text };

            } catch (e: any) {
                lastError = e;
                console.error(`[${this.providerName}] Error (attempt ${attempt + 1}/${maxRetries}):`, e.message);
                const errorInfo = categorizeError(e, this.providerName, this.model);

                if (errorInfo.code === LLMErrorCode.RATE_LIMIT && attempt < maxRetries - 1) {
                    const waitTime = (attempt + 1) * 3000;
                    console.log(`[${this.providerName}] Rate limited, waiting ${waitTime}ms...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    continue;
                }

                if (!errorInfo.retryable || attempt >= maxRetries - 1) {
                    return { text: "", error: errorInfo.message };
                }

                await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 2000));
            }
        }

        const errorInfo = categorizeError(lastError, this.providerName, this.model);
        return { text: "", error: errorInfo.message };
    }
}

export class OpenRouterProvider extends OpenAICompatibleProvider {
    constructor(apiKey: string, model: string = 'deepseek/deepseek-v4-flash') {
        super('OpenRouter', apiKey, model, 'https://openrouter.ai/api/v1', {
            'HTTP-Referer': 'https://intervu.cc',
            'X-Title': 'Intervu',
        });
    }
}

export class GroqProvider extends OpenAICompatibleProvider {
    constructor(apiKey: string, model: string = GROQ_DEFAULT_MODEL) {
        super('Groq', apiKey, model, GROQ_BASE_URL);
    }
}

export class ProviderFactory {
    static getProvider(provider: string, apiKey: string, model?: string): LLMProvider {
        if (!apiKey || apiKey.trim() === '') {
            throw new Error('Missing API key. Please check your configuration.');
        }
        if (provider === 'groq') {
            return new GroqProvider(apiKey, model);
        }
        return new OpenRouterProvider(apiKey, model);
    }
}

export type { LLMErrorInfo as ErrorInfo };

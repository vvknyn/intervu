// Enhanced caching integration for DashboardContainer
// This file contains helper functions to integrate the new InterviewCache system

import { InterviewCache, CachedInterviewData, resolveCacheLookup } from "@/lib/interview-cache";
import { RateLimiter } from "@/lib/rate-limiter";
import { fetchServerCache, saveServerCache } from "@/actions/cache";
import type { PrepJobContext } from "@/lib/prep/job-context";
import { resolvePlanCacheKey } from "@/lib/prep/cache-key";
import type {
    CompanyReconData,
    MatchData,
    QuestionsData,
    ReverseQuestionsData,
    TechnicalData,
    CodingChallenge,
    SystemDesignData,
} from "@/types";

export interface EnhancedCachePayload {
    timestamp: number;
    cacheKey: string;
    company: string;
    position: string;
    round: string;
    hasContext: boolean;
    reconData?: CompanyReconData;
    matchData?: MatchData;
    questionsData?: QuestionsData;
    reverseData?: ReverseQuestionsData;
    technicalData?: TechnicalData;
    codingChallenges?: CodingChallenge[];
    systemDesignData?: SystemDesignData;
}

export interface CacheLookupOptions {
    /** Canonical key when already known (list item, session, server response). */
    cacheKey?: string;
    jobContext?: PrepJobContext;
    jdFingerprint?: string;
}

function resolveLookupKeys(
    company: string,
    position: string,
    round: string,
    options?: CacheLookupOptions,
): { primaryKey: string; legacyKey: string; jdFingerprint?: string } {
    if (options?.cacheKey) {
        return {
            primaryKey: options.cacheKey,
            legacyKey: options.cacheKey,
            jdFingerprint: options.jdFingerprint,
        };
    }

    if (options?.jobContext) {
        const resolved = resolvePlanCacheKey(options.jobContext);
        return resolved;
    }

    const jdFingerprint = options?.jdFingerprint;
    return resolveCacheLookup(company, position, round, jdFingerprint);
}

function toEnhancedPayload(cached: CachedInterviewData): EnhancedCachePayload {
    return {
        timestamp: cached.createdAt,
        cacheKey: cached.cacheKey,
        company: cached.company,
        position: cached.position,
        round: cached.round,
        hasContext: cached.hasResumeContext,
        reconData: cached.reconData,
        matchData: cached.matchData,
        questionsData: cached.questionsData,
        reverseData: cached.reverseData,
        technicalData: cached.technicalData,
        codingChallenges: cached.codingChallenges || [],
        systemDesignData: cached.systemDesignData,
    };
}

async function tryLoadCacheKey(cacheKey: string): Promise<EnhancedCachePayload | null> {
    const cached = InterviewCache.get(cacheKey);
    if (cached) {
        console.log('[EnhancedCache] Client cache hit:', cacheKey);
        return toEnhancedPayload(cached);
    }

    const serverCached = await fetchServerCache(cacheKey);
    if (serverCached.data) {
        console.log('[EnhancedCache] Server cache hit:', cacheKey);
        InterviewCache.set(serverCached.data);
        return toEnhancedPayload(serverCached.data);
    }

    return null;
}

/**
 * Load cached interview data (checks client then server cache).
 * Tries JD-aware primary key first, then legacy key when they differ.
 */
export async function loadEnhancedCache(
    company: string,
    position: string,
    round: string,
    options?: CacheLookupOptions,
): Promise<EnhancedCachePayload | null> {
    try {
        const { primaryKey, legacyKey } = resolveLookupKeys(company, position, round, options);

        let loaded = await tryLoadCacheKey(primaryKey);
        if (!loaded && legacyKey !== primaryKey) {
            loaded = await tryLoadCacheKey(legacyKey);
        }

        if (loaded) {
            return loaded;
        }

        console.log('[EnhancedCache] Cache miss:', primaryKey);
        return null;
    } catch (e) {
        console.error('[EnhancedCache] Load error:', e);
        return null;
    }
}

/**
 * Save interview data to both client and server cache using the canonical plan key.
 */
export async function saveEnhancedCache(
    company: string,
    position: string,
    round: string,
    data: {
        reconData?: CompanyReconData;
        matchData?: MatchData;
        questionsData?: QuestionsData;
        reverseData?: ReverseQuestionsData;
        technicalData?: TechnicalData;
        codingChallenges?: CodingChallenge[];
        systemDesignData?: SystemDesignData;
    },
    hasResumeContext: boolean,
    resumeCompanies?: string[],
    options?: CacheLookupOptions,
): Promise<string> {
    try {
        const { primaryKey, jdFingerprint } = resolveLookupKeys(company, position, round, options);
        const cacheKey = options?.cacheKey ?? primaryKey;
        const now = Date.now();

        const cachedData: CachedInterviewData = {
            cacheKey,
            company,
            position,
            round,
            ...(jdFingerprint !== undefined ? { jdFingerprint } : {}),
            hasResumeContext,
            createdAt: now,
            expiresAt: now + (24 * 60 * 60 * 1000),
            reconData: data.reconData,
            matchData: data.matchData,
            questionsData: data.questionsData,
            reverseData: data.reverseData,
            technicalData: data.technicalData,
            codingChallenges: data.codingChallenges || [],
            systemDesignData: data.systemDesignData,
            resumeCompanies: resumeCompanies || [],
        };

        InterviewCache.set(cachedData);
        console.log('[EnhancedCache] Saved to client cache:', cacheKey);

        saveServerCache(cachedData).catch(e => {
            console.error('[EnhancedCache] Failed to save to server cache:', e);
        });

        return cacheKey;
    } catch (e) {
        console.error('[EnhancedCache] Save error:', e);
        return options?.cacheKey ?? resolveLookupKeys(company, position, round, options).primaryKey;
    }
}

/**
 * Check if user can make an API request (rate limiting)
 */
export function canMakeRequest(userId: string): { allowed: boolean; message?: string } {
    if (!RateLimiter.canMakeRequest(userId)) {
        const remaining = RateLimiter.getTimeUntilReset(userId);
        const timeStr = RateLimiter.formatTimeRemaining(remaining);

        return {
            allowed: false,
            message: `Rate limit exceeded. Please wait ${timeStr} before searching again.`
        };
    }

    return { allowed: true };
}

/**
 * Record an API request (for rate limiting)
 */
export function recordRequest(userId: string): void {
    RateLimiter.recordRequest(userId);
    const remaining = RateLimiter.getRemainingRequests(userId);
    console.log(`[RateLimit] ${remaining} requests remaining this minute`);
}

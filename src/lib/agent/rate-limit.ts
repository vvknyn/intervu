/**
 * Single-process in-memory sliding-window rate limiter — acceptable only
 * because intervu currently runs one container; move to a shared store
 * (e.g. Redis) if the agent API ever scales beyond one process.
 */
import { AGENT } from './config';

const hits = new Map<string, number[]>();

export function checkRateLimit(credentialId: string, now?: number) {
    const at = now ?? Date.now();
    const cutoff = at - AGENT.RATE_WINDOW_MS;
    const timestamps = (hits.get(credentialId) ?? []).filter((t) => t > cutoff);

    if (timestamps.length >= AGENT.RATE_LIMIT) {
        const retryAfterSec = Math.ceil((timestamps[0] + AGENT.RATE_WINDOW_MS - at) / 1000);
        hits.set(credentialId, timestamps);
        return { ok: false, remaining: 0, retryAfterSec };
    }

    timestamps.push(at);
    hits.set(credentialId, timestamps);
    return { ok: true, remaining: AGENT.RATE_LIMIT - timestamps.length, retryAfterSec: 0 };
}

export function _resetRateLimits(): void {
    hits.clear();
}

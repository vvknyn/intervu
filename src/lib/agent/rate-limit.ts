/**
 * Single-process in-memory sliding-window rate limiter — acceptable only
 * because intervu currently runs one container; move to a shared store
 * (e.g. Redis) if the agent API ever scales beyond one process.
 */
import { NextResponse } from 'next/server';
import { AGENT } from './config';
import { logAgentLimit, truncateCredential } from './log';

const hits = new Map<string, number[]>();

/**
 * `limit` defaults to the standard per-credential `AGENT.RATE_LIMIT`; the two
 * public, unauthenticated OAuth routes (register/token) pass
 * `AGENT.PUBLIC_RATE_LIMIT` instead — same sliding-window mechanism, a wider
 * budget, because they key by shared egress IP rather than by credential
 * (see `PUBLIC_RATE_LIMIT`'s doc comment, config.ts).
 *
 * `label` names WHAT was being called (an MCP tool name, or a fixed label
 * for the two OAuth routes) — purely for the `logAgentLimit` line below, so
 * a future incident like the 2026-08-06 one (a real session rate_limited
 * after a handful of visible tool calls, root-caused only after the fact)
 * can be read straight from logs instead of reasoned about blind.
 */
export function checkRateLimit(
    credentialId: string,
    now?: number,
    limit: number = AGENT.RATE_LIMIT,
    label: string = 'unknown',
) {
    const at = now ?? Date.now();
    const cutoff = at - AGENT.RATE_WINDOW_MS;
    const timestamps = (hits.get(credentialId) ?? []).filter((t) => t > cutoff);
    const credential = truncateCredential(credentialId);

    if (timestamps.length >= limit) {
        const retryAfterSec = Math.ceil((timestamps[0] + AGENT.RATE_WINDOW_MS - at) / 1000);
        hits.set(credentialId, timestamps);
        logAgentLimit('agent-rate-limit', 'REJECT', {
            credential, hits: timestamps.length, limit, windowMs: AGENT.RATE_WINDOW_MS, retryAfterS: retryAfterSec,
        });
        return { ok: false, remaining: 0, retryAfterSec };
    }

    timestamps.push(at);
    hits.set(credentialId, timestamps);
    logAgentLimit('agent-rate-limit', 'ok', { credential, tool: label, hits: `${timestamps.length}/${limit}` });
    return { ok: true, remaining: limit - timestamps.length, retryAfterSec: 0 };
}

export function _resetRateLimits(): void {
    hits.clear();
}

/**
 * Best-effort caller IP for the rate-limit key on public/unauthenticated
 * endpoints (`/api/oauth/register`, `/api/oauth/token`) that have no
 * credential yet to key on. The app runs behind exactly one reverse proxy
 * (Caddy), which — like every standard reverse proxy — APPENDS its own view
 * of the connecting peer to `X-Forwarded-For` rather than replacing it, so
 * the LAST entry is the one Caddy itself derived from the raw TCP
 * connection and the caller cannot forge. The FIRST entry is whatever the
 * caller chose to send (or omit) — trusting that one would let a single
 * client rotate a fake IP on every request, both defeating the per-IP
 * budget and growing `hits` without bound (a new never-evicted Map key per
 * forged value). A client that omits the header entirely falls back to a
 * shared `"unknown"` bucket — that only means those callers share one
 * budget, never a way to dodge the limit.
 */
export function clientIpFromRequest(request: Request): string {
    const forwardedFor = request.headers.get('x-forwarded-for');
    const hops = forwardedFor?.split(',').map((h) => h.trim()).filter(Boolean) ?? [];
    return hops.length > 0 ? hops[hops.length - 1] : 'unknown';
}

/** The one shape a 429 from this limiter takes on the wire — every route
 *  that calls `checkRateLimit` and gets `{ ok: false }` back renders it
 *  through this, so the three call sites (`/api/mcp`, `/api/oauth/register`,
 *  `/api/oauth/token`) can never drift into three different error bodies.
 *  `error` stays `'rate_limited'` (existing clients that only read that
 *  field keep working unchanged) — `retryAfterSeconds` and `limiter` are
 *  additive, giving a client that reads JSON the same information the
 *  `Retry-After` header already carries, plus which budget it hit. Every
 *  caller of `checkRateLimit` enforces the same hourly sliding window (a
 *  wider one for the two IP-keyed OAuth routes, see `PUBLIC_RATE_LIMIT`'s
 *  doc comment), so `'hourly_calls'` is accurate everywhere this renders. */
export function rateLimitedResponse(retryAfterSec: number): Response {
    return NextResponse.json(
        { error: 'rate_limited', retryAfterSeconds: retryAfterSec, limiter: 'hourly_calls' },
        { status: 429, headers: { 'Retry-After': String(retryAfterSec) } }
    );
}

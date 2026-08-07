import { describe, it, beforeEach } from 'node:test'; import assert from 'node:assert/strict';
import { checkRateLimit, _resetRateLimits, clientIpFromRequest, rateLimitedResponse } from '../../src/lib/agent/rate-limit';
import { AGENT } from '../../src/lib/agent/config';
describe('agent rate limit', () => {
  beforeEach(() => { _resetRateLimits(); });
  it('allows up to RATE_LIMIT calls then denies the next with retryAfterSec > 0', () => {
    const now = 1_000_000;
    for (let i = 0; i < AGENT.RATE_LIMIT; i++) {
      const r = checkRateLimit('cred-a', now);
      assert.equal(r.ok, true, `call ${i + 1} should be ok`);
    }
    const denied = checkRateLimit('cred-a', now);
    assert.equal(denied.ok, false);
    assert.equal(denied.remaining, 0);
    assert.ok(denied.retryAfterSec > 0);
  });
  it('slides the window: after denial, a call at now + RATE_WINDOW_MS + 1 succeeds', () => {
    const now = 2_000_000;
    for (let i = 0; i < AGENT.RATE_LIMIT; i++) checkRateLimit('cred-b', now);
    assert.equal(checkRateLimit('cred-b', now).ok, false);
    const later = checkRateLimit('cred-b', now + AGENT.RATE_WINDOW_MS + 1);
    assert.equal(later.ok, true);
  });
  it('does not share budget across different credentialIds (isolation — no shared/global key)', () => {
    const now = 3_000_000;
    for (let i = 0; i < AGENT.RATE_LIMIT; i++) checkRateLimit('cred-c', now);
    assert.equal(checkRateLimit('cred-c', now).ok, false);
    const other = checkRateLimit('cred-d', now);
    assert.equal(other.ok, true);
  });
  it('two credentials calling in lockstep never bleed into each other\'s count — a brand-new credential\'s first-ever call is always ok even while another credential is exhausted', () => {
    const now = 3_500_000;
    for (let i = 0; i < AGENT.RATE_LIMIT; i++) checkRateLimit('cred-exhausted', now);
    assert.equal(checkRateLimit('cred-exhausted', now).ok, false, 'sanity: this credential is exhausted');
    const fresh = checkRateLimit('cred-never-seen-before', now);
    assert.equal(fresh.ok, true, "a truly fresh credential id must never inherit another credential's hits");
    assert.equal(fresh.remaining, AGENT.RATE_LIMIT - 1);
  });
  it('accepts an omitted now (optional param defaults to Date.now())', () => {
    _resetRateLimits();
    assert.doesNotThrow(() => checkRateLimit('cred-e'));
    const r = checkRateLimit('cred-f');
    assert.equal(r.ok, true);
  });

  it('prunes only entries older than RATE_WINDOW_MS — the window actually slides, it does not just accumulate forever', () => {
    const start = 5_000_000;
    const limit = 60; // explicit, independent of AGENT.RATE_LIMIT's actual value
    // Batch 1: 30 calls right at the window's start.
    for (let i = 0; i < 30; i++) checkRateLimit('cred-slide', start, limit);
    // Batch 2: 30 more calls just inside the window (window hasn't rolled yet).
    for (let i = 0; i < 30; i++) checkRateLimit('cred-slide', start + AGENT.RATE_WINDOW_MS - 1, limit);
    // All 60 are still within the window: the 61st call right now is denied.
    assert.equal(
      checkRateLimit('cred-slide', start + AGENT.RATE_WINDOW_MS - 1, limit).ok,
      false,
      'sanity: 60 hits in-window should exhaust a 60 limit',
    );
    // Once batch 1's timestamps age out (now > start + RATE_WINDOW_MS) but
    // batch 2's have not, only the aged-out half is pruned — proving prune
    // is timestamp-by-timestamp, not all-or-nothing.
    const afterBatch1Expires = start + AGENT.RATE_WINDOW_MS + 1;
    const r = checkRateLimit('cred-slide', afterBatch1Expires, 31);
    assert.equal(r.ok, true, "batch 1 (30, aged out) must no longer count, leaving room under a 31 limit for batch 2's 30 survivors");
    assert.equal(r.remaining, 0, "batch 2's 30 survivors + this new call = 31, exactly at the 31 limit");
  });

  it('IMPORTANT 4 — an explicit limit override replaces AGENT.RATE_LIMIT entirely, independent of the 300 default', () => {
    const now = 4_000_000;
    const publicLimit = AGENT.PUBLIC_RATE_LIMIT;
    assert.ok(publicLimit > AGENT.RATE_LIMIT, 'test assumes the public limit is wider than the default');
    // A call past the DEFAULT budget must still be ok under the wider override.
    for (let i = 0; i < AGENT.RATE_LIMIT + 1; i++) {
      const r = checkRateLimit('cred-public', now, publicLimit);
      assert.equal(r.ok, true, `call ${i + 1} (past the 300 default) should still be ok under the ${publicLimit} override`);
    }
    // Drain the rest of the override budget, then the next call is denied.
    for (let i = AGENT.RATE_LIMIT + 1; i < publicLimit; i++) checkRateLimit('cred-public', now, publicLimit);
    const denied = checkRateLimit('cred-public', now, publicLimit);
    assert.equal(denied.ok, false);
  });
});

describe('clientIpFromRequest — keying for the two public unauthenticated OAuth endpoints', () => {
  it('reads the LAST (rightmost) hop out of a multi-hop X-Forwarded-For — the one Caddy itself appended', () => {
    const req = new Request('http://x', { headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1, 10.0.0.2' } });
    assert.equal(clientIpFromRequest(req), '10.0.0.2');
  });
  it('is not fooled by a caller-forged leftmost entry (spoofing resistance)', () => {
    // A direct HTTP client can freely set X-Forwarded-For itself. If Caddy
    // appends its own hop (standard reverse-proxy behavior) rather than
    // replacing the header, the forged value ends up first — reading the
    // last entry instead means the forged value here is ignored.
    const req = new Request('http://x', { headers: { 'x-forwarded-for': '1.2.3.4' /* forged */ + ', 198.51.100.9' /* Caddy's real hop */ } });
    assert.equal(clientIpFromRequest(req), '198.51.100.9');
  });
  it('trims whitespace around the last hop', () => {
    const req = new Request('http://x', { headers: { 'x-forwarded-for': '203.0.113.5,   10.0.0.1  ' } });
    assert.equal(clientIpFromRequest(req), '10.0.0.1');
  });
  it('handles a single-value header (no comma) — e.g. Caddy replaced rather than appended', () => {
    const req = new Request('http://x', { headers: { 'x-forwarded-for': '203.0.113.5' } });
    assert.equal(clientIpFromRequest(req), '203.0.113.5');
  });
  it('falls back to a shared "unknown" bucket when the header is absent', () => {
    assert.equal(clientIpFromRequest(new Request('http://x')), 'unknown');
  });
  it('falls back to "unknown" for an empty or whitespace-only header value', () => {
    assert.equal(clientIpFromRequest(new Request('http://x', { headers: { 'x-forwarded-for': '' } })), 'unknown');
    assert.equal(clientIpFromRequest(new Request('http://x', { headers: { 'x-forwarded-for': ' , ,' } })), 'unknown');
  });
});

describe('rateLimitedResponse — the one 429 shape shared by /api/mcp, /api/oauth/register, /api/oauth/token', () => {
  it('carries Retry-After in seconds and the rate_limited body, plus retryAfterSeconds/limiter for JSON-only clients', async () => {
    const res = rateLimitedResponse(42);
    assert.equal(res.status, 429);
    assert.equal(res.headers.get('Retry-After'), '42');
    assert.deepEqual(await res.json(), { error: 'rate_limited', retryAfterSeconds: 42, limiter: 'hourly_calls' });
  });
  it('an existing client that only reads the error field keeps working — the field is still present with the same value', async () => {
    const body = await rateLimitedResponse(7).json();
    assert.equal(body.error, 'rate_limited');
  });
  it('retryAfterSeconds on a real reject matches checkRateLimit\'s own retryAfterSec, end to end', async () => {
    _resetRateLimits();
    const now = 6_000_000;
    const limit = 5;
    for (let i = 0; i < limit; i++) checkRateLimit('cred-e2e', now, limit);
    const denied = checkRateLimit('cred-e2e', now, limit);
    assert.equal(denied.ok, false);
    const res = rateLimitedResponse(denied.retryAfterSec);
    const body = await res.json();
    assert.equal(body.retryAfterSeconds, denied.retryAfterSec);
    assert.equal(res.headers.get('Retry-After'), String(denied.retryAfterSec));
    assert.ok(denied.retryAfterSec > 0, 'a real reject always carries a positive retry-after');
  });
});

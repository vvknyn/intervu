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
  it('does not share budget across different credentialIds', () => {
    const now = 3_000_000;
    for (let i = 0; i < AGENT.RATE_LIMIT; i++) checkRateLimit('cred-c', now);
    assert.equal(checkRateLimit('cred-c', now).ok, false);
    const other = checkRateLimit('cred-d', now);
    assert.equal(other.ok, true);
  });
  it('accepts an omitted now (optional param defaults to Date.now())', () => {
    _resetRateLimits();
    assert.doesNotThrow(() => checkRateLimit('cred-e'));
    const r = checkRateLimit('cred-f');
    assert.equal(r.ok, true);
  });

  it('IMPORTANT 4 — an explicit limit override replaces AGENT.RATE_LIMIT entirely, independent of the 60 default', () => {
    const now = 4_000_000;
    const publicLimit = AGENT.PUBLIC_RATE_LIMIT;
    assert.ok(publicLimit > AGENT.RATE_LIMIT, 'test assumes the public limit is wider than the default');
    // The 61st call is past the DEFAULT budget but must still be ok under the wider override.
    for (let i = 0; i < AGENT.RATE_LIMIT + 1; i++) {
      const r = checkRateLimit('cred-public', now, publicLimit);
      assert.equal(r.ok, true, `call ${i + 1} (past the 60 default) should still be ok under the ${publicLimit} override`);
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
  it('carries Retry-After in seconds and the rate_limited body', async () => {
    const res = rateLimitedResponse(42);
    assert.equal(res.status, 429);
    assert.equal(res.headers.get('Retry-After'), '42');
    assert.deepEqual(await res.json(), { error: 'rate_limited' });
  });
});

import { describe, it, beforeEach } from 'node:test'; import assert from 'node:assert/strict';
import { AGENT } from '../../src/lib/agent/config';
import { _resetRateLimits } from '../../src/lib/agent/rate-limit';
import { POST } from '../../src/app/api/oauth/token/route';

describe('POST /api/oauth/token — per-IP rate limit (public, unauthenticated endpoint)', () => {
  beforeEach(() => { _resetRateLimits(); });

  // Deliberately invalid grant_type — the request short-circuits to
  // `invalid_request` before `exchangeCode`/`refreshAccess` ever run, so the
  // rate-limit gate is exercised in isolation from storage.
  function reqFrom(ip: string): Request {
    return new Request('http://x/api/oauth/token', {
      method: 'POST',
      headers: { 'x-forwarded-for': ip, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
  }

  it('429s after AGENT.PUBLIC_RATE_LIMIT requests from the same IP', async () => {
    const ip = '198.51.100.30';
    for (let i = 0; i < AGENT.PUBLIC_RATE_LIMIT; i++) {
      const res = await POST(reqFrom(ip));
      assert.equal(res.status, 400, `request ${i + 1} should still be under budget`);
    }
    const limited = await POST(reqFrom(ip));
    assert.equal(limited.status, 429);
    assert.deepEqual(await limited.json(), { error: 'rate_limited' });
  });

  it('IMPORTANT 4 — the 61st request is still ok (past the 60 per-credential default, under the wider public budget)', async () => {
    const ip = '198.51.100.31';
    assert.ok(AGENT.PUBLIC_RATE_LIMIT > AGENT.RATE_LIMIT);
    for (let i = 0; i < AGENT.RATE_LIMIT + 1; i++) {
      const res = await POST(reqFrom(ip));
      assert.equal(res.status, 400, `request ${i + 1} should be under the public budget, not the 60 default`);
    }
  });

  it('does not share budget across different caller IPs (keyed by IP, not global)', async () => {
    const ipA = '198.51.100.40';
    for (let i = 0; i < AGENT.PUBLIC_RATE_LIMIT; i++) await POST(reqFrom(ipA));
    assert.equal((await POST(reqFrom(ipA))).status, 429);

    const ipB = '198.51.100.41';
    assert.equal((await POST(reqFrom(ipB))).status, 400);
  });

  it('keys separately from /api/oauth/register (\'token:\' vs \'dcr:\' prefix, same IP)', async () => {
    // Exhausting the token-route budget for an IP must not affect that same
    // IP's DCR budget — proves the two endpoints don't collide on one shared
    // rate-limit key despite reusing the same limiter and the same IP.
    const { POST: registerPost } = await import('../../src/app/api/oauth/register/route');
    const ip = '198.51.100.50';
    for (let i = 0; i < AGENT.PUBLIC_RATE_LIMIT; i++) await POST(reqFrom(ip));
    assert.equal((await POST(reqFrom(ip))).status, 429);

    const dcrReq = new Request('http://x/api/oauth/register', {
      method: 'POST',
      headers: { 'x-forwarded-for': ip, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal((await registerPost(dcrReq)).status, 400);
  });
});

describe('POST /api/oauth/token — RFC 6749 §5.1 MUST: Cache-Control: no-store', () => {
  beforeEach(() => { _resetRateLimits(); });

  it('carries Cache-Control: no-store on an error response (this route\'s own JSON builder wraps every return, success or error alike)', async () => {
    const req = new Request('http://x/api/oauth/token', {
      method: 'POST',
      headers: { 'x-forwarded-for': '198.51.100.60', 'content-type': 'application/json' },
      body: JSON.stringify({}), // no grant_type -> invalid_request, before any storage is touched
    });
    const res = await POST(req);
    assert.equal(res.status, 400);
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
  });
});

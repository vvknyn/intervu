import { describe, it, beforeEach } from 'node:test'; import assert from 'node:assert/strict';
import { AGENT } from '../../src/lib/agent/config';
import { _resetRateLimits } from '../../src/lib/agent/rate-limit';
import { POST, handleTokenRequest } from '../../src/app/api/oauth/token/route';
import { memoryStore } from '../../src/lib/agent/store';
import { registerClient, createAuthCode } from '../../src/lib/agent/oauth';
import { createHash } from 'node:crypto';

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
    const body = await limited.json();
    assert.equal(body.error, 'rate_limited');
    assert.equal(body.limiter, 'hourly_calls');
    assert.ok(typeof body.retryAfterSeconds === 'number' && body.retryAfterSeconds > 0);
  });

  it('IMPORTANT 4 — a request past the 300 per-credential default is still ok, under the wider public budget', async () => {
    const ip = '198.51.100.31';
    assert.ok(AGENT.PUBLIC_RATE_LIMIT > AGENT.RATE_LIMIT);
    for (let i = 0; i < AGENT.RATE_LIMIT + 1; i++) {
      const res = await POST(reqFrom(ip));
      assert.equal(res.status, 400, `request ${i + 1} should be under the public budget, not the 300 default`);
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

describe('POST /api/oauth/token — a client that authenticates with HTTP Basic (client_secret_basic)', () => {
  beforeEach(() => { _resetRateLimits(); });

  const VERIFIER = 'v'.repeat(64);
  const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');
  const REDIRECT = 'https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-1234-velai_app';

  async function setup() {
    const store = memoryStore();
    const reg = await registerClient(store, { client_name: 'Gemini', redirect_uris: [REDIRECT] });
    if ('error' in reg) throw new Error(reg.error);
    const code = await createAuthCode(store, { uid: 'u1', clientId: reg.client.id, redirectUri: REDIRECT, codeChallenge: CHALLENGE });
    return { store, clientId: reg.client.id, code };
  }

  function tokenReq(fields: Record<string, string>, authorization?: string): Request {
    return new Request('http://x/api/oauth/token', {
      method: 'POST',
      headers: {
        'x-forwarded-for': '198.51.100.70',
        'content-type': 'application/x-www-form-urlencoded',
        ...(authorization ? { authorization } : {}),
      },
      body: new URLSearchParams(fields).toString(),
    });
  }

  it('exchanges the code when client_id is only in the Basic header (the secret is ignored)', async () => {
    const { store, clientId, code } = await setup();
    const res = await handleTokenRequest(
      tokenReq(
        { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: VERIFIER },
        `Basic ${btoa(`${clientId}:whatever-secret`)}`,
      ),
      store,
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.token_type, 'Bearer');
    assert.ok(body.access_token && body.refresh_token);
  });

  it('refreshes with client_id only in the Basic header', async () => {
    const { store, clientId, code } = await setup();
    const first = await (await handleTokenRequest(
      tokenReq({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: VERIFIER, client_id: clientId }),
      store,
    )).json();
    const res = await handleTokenRequest(
      tokenReq({ grant_type: 'refresh_token', refresh_token: first.refresh_token }, `Basic ${btoa(`${clientId}:`)}`),
      store,
    );
    assert.equal(res.status, 200);
    assert.ok((await res.json()).access_token);
  });

  it('still needs a client_id from somewhere: no body field and no Basic header is invalid_request', async () => {
    const { store, code } = await setup();
    const res = await handleTokenRequest(
      tokenReq({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: VERIFIER }),
      store,
    );
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'invalid_request');
  });

  it('the body client_id wins over the header, and a Basic id for another client cannot redeem the code', async () => {
    const { store, clientId, code } = await setup();
    const other = await registerClient(store, { client_name: 'Other', redirect_uris: ['https://other.example/cb'] });
    if ('error' in other) throw new Error(other.error);
    const res = await handleTokenRequest(
      tokenReq(
        { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: VERIFIER },
        `Basic ${btoa(`${other.client.id}:`)}`,
      ),
      store,
    );
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'invalid_grant');
    // the failed attempt burned the code (exchangeCode claims first), so redo on a fresh one for the body-wins case
    const fresh = await createAuthCode(store, { uid: 'u1', clientId, redirectUri: REDIRECT, codeChallenge: CHALLENGE });
    const ok = await handleTokenRequest(
      tokenReq(
        { grant_type: 'authorization_code', code: fresh, redirect_uri: REDIRECT, code_verifier: VERIFIER, client_id: clientId },
        `Basic ${btoa(`${other.client.id}:`)}`,
      ),
      store,
    );
    assert.equal(ok.status, 200);
  });

  it('PKCE still gates it: a Basic client with the wrong verifier gets invalid_grant', async () => {
    const { store, clientId, code } = await setup();
    const res = await handleTokenRequest(
      tokenReq(
        { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: 'w'.repeat(64) },
        `Basic ${btoa(`${clientId}:`)}`,
      ),
      store,
    );
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'invalid_grant');
  });
});

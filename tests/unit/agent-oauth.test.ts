import { describe, it } from 'node:test'; import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { memoryStore } from '../../src/lib/agent/store';
import { registerClient, getClient, createAuthCode, exchangeCode, refreshAccess } from '../../src/lib/agent/oauth';
import { issueCredential } from '../../src/lib/agent/tokens';

const verifier = 'test-verifier-string-43-chars-minimum-okays1';
const challenge = createHash('sha256').update(verifier).digest('base64url');

async function registerOk(store: ReturnType<typeof memoryStore>, redirectUris = ['https://client.example/cb']) {
  const res = await registerClient(store, { client_name: 'Test Client', redirect_uris: redirectUris });
  if ('error' in res) throw new Error(`registerClient failed: ${res.error}`);
  return res.client;
}

describe('agent oauth', () => {
  it('happy path: DCR -> code -> exchange yields a working token pair', async () => {
    const s = memoryStore();
    const client = await registerOk(s);
    assert.ok(client.id);
    assert.deepEqual(client.redirectUris, ['https://client.example/cb']);

    const fetched = await getClient(s, client.id);
    assert.equal(fetched?.id, client.id);

    const code = await createAuthCode(s, {
      uid: 'user-1', clientId: client.id, redirectUri: 'https://client.example/cb', codeChallenge: challenge,
    });
    assert.equal(typeof code, 'string');

    const result = await exchangeCode(s, {
      code, clientId: client.id, redirectUri: 'https://client.example/cb', codeVerifier: verifier,
    });
    if ('error' in result) throw new Error(`exchangeCode failed: ${result.error}`);
    assert.match(result.access_token, /^iva_/);
    assert.match(result.refresh_token, /^ivr_/);
    assert.equal(result.expires_in, 3600); // ACCESS_TTL_MS / 1000
    assert.equal(result.token_type, 'Bearer');
  });

  it('rejects a second exchange of the same code (single-use)', async () => {
    const s = memoryStore();
    const client = await registerOk(s);
    const code = await createAuthCode(s, {
      uid: 'user-1', clientId: client.id, redirectUri: 'https://client.example/cb', codeChallenge: challenge,
    });
    const opts = { code, clientId: client.id, redirectUri: 'https://client.example/cb', codeVerifier: verifier };
    const first = await exchangeCode(s, opts);
    assert.ok(!('error' in first));
    const second = await exchangeCode(s, opts);
    assert.ok('error' in second);
  });

  it('rejects exchange with the wrong verifier', async () => {
    const s = memoryStore();
    const client = await registerOk(s);
    const code = await createAuthCode(s, {
      uid: 'user-1', clientId: client.id, redirectUri: 'https://client.example/cb', codeChallenge: challenge,
    });
    const result = await exchangeCode(s, {
      code, clientId: client.id, redirectUri: 'https://client.example/cb', codeVerifier: 'wrong-verifier-value',
    });
    assert.ok('error' in result);
  });

  it('rejects exchange with the wrong redirectUri', async () => {
    const s = memoryStore();
    const client = await registerOk(s);
    const code = await createAuthCode(s, {
      uid: 'user-1', clientId: client.id, redirectUri: 'https://client.example/cb', codeChallenge: challenge,
    });
    const result = await exchangeCode(s, {
      code, clientId: client.id, redirectUri: 'https://client.example/other', codeVerifier: verifier,
    });
    assert.ok('error' in result);
  });

  it('rejects exchange with the wrong clientId', async () => {
    const s = memoryStore();
    const client = await registerOk(s);
    const other = await registerOk(s, ['https://other.example/cb']);
    const code = await createAuthCode(s, {
      uid: 'user-1', clientId: client.id, redirectUri: 'https://client.example/cb', codeChallenge: challenge,
    });
    const result = await exchangeCode(s, {
      code, clientId: other.id, redirectUri: 'https://client.example/cb', codeVerifier: verifier,
    });
    assert.ok('error' in result);
  });

  it('rejects an unknown code', async () => {
    const s = memoryStore();
    const client = await registerOk(s);
    const result = await exchangeCode(s, {
      code: 'not-a-real-code', clientId: client.id, redirectUri: 'https://client.example/cb', codeVerifier: verifier,
    });
    assert.ok('error' in result);
  });

  it('refresh rotates: old refresh token dies, new pair works', async () => {
    const s = memoryStore();
    const client = await registerOk(s);
    const code = await createAuthCode(s, {
      uid: 'user-1', clientId: client.id, redirectUri: 'https://client.example/cb', codeChallenge: challenge,
    });
    const first = await exchangeCode(s, {
      code, clientId: client.id, redirectUri: 'https://client.example/cb', codeVerifier: verifier,
    });
    if ('error' in first) throw new Error('setup exchange failed');

    const refreshed = await refreshAccess(s, { refreshSecret: first.refresh_token, clientId: client.id });
    if ('error' in refreshed) throw new Error(`refreshAccess failed: ${refreshed.error}`);
    assert.match(refreshed.access_token, /^iva_/);
    assert.match(refreshed.refresh_token, /^ivr_/);
    assert.notEqual(refreshed.refresh_token, first.refresh_token);

    // old refresh token is dead
    const reuseOld = await refreshAccess(s, { refreshSecret: first.refresh_token, clientId: client.id });
    assert.ok('error' in reuseOld);

    // new refresh token works
    const second = await refreshAccess(s, { refreshSecret: refreshed.refresh_token, clientId: client.id });
    assert.ok(!('error' in second));
  });

  it('refresh rejects a wrong clientId', async () => {
    const s = memoryStore();
    const client = await registerOk(s);
    const other = await registerOk(s, ['https://other.example/cb']);
    const code = await createAuthCode(s, {
      uid: 'user-1', clientId: client.id, redirectUri: 'https://client.example/cb', codeChallenge: challenge,
    });
    const first = await exchangeCode(s, {
      code, clientId: client.id, redirectUri: 'https://client.example/cb', codeVerifier: verifier,
    });
    if ('error' in first) throw new Error('setup exchange failed');
    const result = await refreshAccess(s, { refreshSecret: first.refresh_token, clientId: other.id });
    assert.ok('error' in result);
  });

  it('refresh rejects an access token passed as a refresh secret (whole credential-kind class, not just refresh)', async () => {
    const s = memoryStore();
    const client = await registerOk(s);
    const code = await createAuthCode(s, {
      uid: 'user-1', clientId: client.id, redirectUri: 'https://client.example/cb', codeChallenge: challenge,
    });
    const first = await exchangeCode(s, {
      code, clientId: client.id, redirectUri: 'https://client.example/cb', codeVerifier: verifier,
    });
    if ('error' in first) throw new Error('setup exchange failed');
    const result = await refreshAccess(s, { refreshSecret: first.access_token, clientId: client.id });
    assert.ok('error' in result);
  });

  it('refresh rejects a manual (non-OAuth) credential passed as a refresh secret', async () => {
    const s = memoryStore();
    const client = await registerOk(s);
    const manual = await issueCredential(s, { uid: 'user-1', kind: 'manual' });
    const result = await refreshAccess(s, { refreshSecret: manual.secret, clientId: client.id });
    assert.ok('error' in result);
  });

  it('registerClient rejects http:// redirect URIs except localhost/127.0.0.1', async () => {
    const s = memoryStore();
    const evil = await registerClient(s, { client_name: 'Evil', redirect_uris: ['http://evil.com/cb'] });
    assert.ok('error' in evil);

    const local = await registerClient(s, { client_name: 'Local Dev', redirect_uris: ['http://localhost:8080/cb'] });
    assert.ok('client' in local);

    const loopback = await registerClient(s, { client_name: 'Loopback Dev', redirect_uris: ['http://127.0.0.1:3000/cb'] });
    assert.ok('client' in loopback);

    const custom = await registerClient(s, { client_name: 'Custom Scheme', redirect_uris: ['myapp://cb'] });
    assert.ok('error' in custom);

    const https = await registerClient(s, { client_name: 'HTTPS Anywhere', redirect_uris: ['https://anywhere.example/cb'] });
    assert.ok('client' in https);
  });

  it('createAuthCode expires after CODE_TTL_MS', async () => {
    const s = memoryStore();
    const client = await registerOk(s);
    const code = await createAuthCode(s, {
      uid: 'user-1', clientId: client.id, redirectUri: 'https://client.example/cb', codeChallenge: challenge,
    });
    // force-expire by rewriting the stored doc's expiry into the past
    const { AGENT } = await import('../../src/lib/agent/config');
    await s.update(AGENT.collections.codes, code, { expiresAt: Date.now() - 1 });
    const result = await exchangeCode(s, {
      code, clientId: client.id, redirectUri: 'https://client.example/cb', codeVerifier: verifier,
    });
    assert.ok('error' in result);
  });
});

import { describe, it } from 'node:test'; import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { memoryStore } from '../../src/lib/agent/store';
import { registerClient, getClient, createAuthCode, exchangeCode, refreshAccess } from '../../src/lib/agent/oauth';
import { issueCredential } from '../../src/lib/agent/tokens';
import { AGENT } from '../../src/lib/agent/config';

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

  // 'wrong-verifier-value' is 21 chars — shorter than RFC 7636's 43-char
  // floor, so this trips `isValidCodeVerifier`'s length guard and never
  // reaches the hash comparison at all. Kept as its own test because it
  // documents that guard; it does NOT prove the hash comparison itself
  // rejects a mismatched verifier — see the VALID-SHAPE test right below
  // (IMPORTANT 7 review fix) for that.
  it('rejects exchange with a too-short wrong verifier (documents the length guard, not the hash check)', async () => {
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

  it('rejects a VALID-SHAPE wrong verifier (43+ chars, legal RFC 7636 charset) — proves the hash comparison itself rejects a mismatch, not just the length guard', async () => {
    const s = memoryStore();
    const client = await registerOk(s);
    const code = await createAuthCode(s, {
      uid: 'user-1', clientId: client.id, redirectUri: 'https://client.example/cb', codeChallenge: challenge,
    });
    // Same length/charset class as `verifier` (legal per CODE_VERIFIER_RE),
    // but a different string — so it clears the length guard and lands on
    // the sha256(verifier) === codeChallenge comparison, which must reject it.
    const validShapeWrongVerifier = 'z'.repeat(50);
    assert.notEqual(validShapeWrongVerifier, verifier);
    const result = await exchangeCode(s, {
      code, clientId: client.id, redirectUri: 'https://client.example/cb', codeVerifier: validShapeWrongVerifier,
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

  it('registerClient redirect URI allowlist: https, localhost http, native MCP schemes; rejects other http and custom schemes', async () => {
    const s = memoryStore();
    const evil = await registerClient(s, { client_name: 'Evil', redirect_uris: ['http://evil.com/cb'] });
    assert.ok('error' in evil);

    const local = await registerClient(s, { client_name: 'Local Dev', redirect_uris: ['http://localhost:8080/cb'] });
    assert.ok('client' in local);

    const loopback = await registerClient(s, { client_name: 'Loopback Dev', redirect_uris: ['http://127.0.0.1:3000/cb'] });
    assert.ok('client' in loopback);

    const cursor = await registerClient(s, {
      client_name: 'Cursor MCP',
      redirect_uris: ['cursor://anysphere.cursor-mcp/oauth/callback'],
    });
    assert.ok('client' in cursor);
    assert.deepEqual(cursor.client.redirectUris, ['cursor://anysphere.cursor-mcp/oauth/callback']);

    const vscode = await registerClient(s, {
      client_name: 'VS Code MCP',
      redirect_uris: ['vscode://publisher.extension/oauth/callback'],
    });
    assert.ok('client' in vscode);

    const vscodeInsiders = await registerClient(s, {
      client_name: 'VS Code Insiders MCP',
      redirect_uris: ['vscode-insiders://publisher.extension/oauth/callback'],
    });
    assert.ok('client' in vscodeInsiders);

    const evilScheme = await registerClient(s, { client_name: 'Evil Scheme', redirect_uris: ['evil://attacker.example/cb'] });
    assert.ok('error' in evilScheme);

    const custom = await registerClient(s, { client_name: 'Custom Scheme', redirect_uris: ['myapp://cb'] });
    assert.ok('error' in custom);

    const bareNative = await registerClient(s, { client_name: 'Bare Native', redirect_uris: ['cursor://'] });
    assert.ok('error' in bareNative);

    const invalid = await registerClient(s, { client_name: 'Invalid URI', redirect_uris: ['not a url'] });
    assert.ok('error' in invalid);

    const https = await registerClient(s, { client_name: 'HTTPS Anywhere', redirect_uris: ['https://anywhere.example/cb'] });
    assert.ok('client' in https);
  });

  it('registerClient rejects more than MAX_REDIRECT_URIS entries', async () => {
    const s = memoryStore();
    const tooMany = Array.from({ length: AGENT.MAX_REDIRECT_URIS + 1 }, (_, i) => `https://client.example/cb${i}`);
    const result = await registerClient(s, { client_name: 'Spammy', redirect_uris: tooMany });
    assert.ok('error' in result);

    const atCap = tooMany.slice(0, AGENT.MAX_REDIRECT_URIS);
    const ok = await registerClient(s, { client_name: 'At Cap', redirect_uris: atCap });
    assert.ok('client' in ok);
  });

  it('registerClient rejects a redirect_uri longer than MAX_REDIRECT_URI_LENGTH chars', async () => {
    const s = memoryStore();
    const longPath = 'a'.repeat(AGENT.MAX_REDIRECT_URI_LENGTH);
    const tooLong = await registerClient(s, { client_name: 'Long', redirect_uris: [`https://client.example/${longPath}`] });
    assert.ok('error' in tooLong);

    const atCapPath = 'a'.repeat(AGENT.MAX_REDIRECT_URI_LENGTH - 'https://client.example/'.length);
    const ok = await registerClient(s, { client_name: 'At Cap', redirect_uris: [`https://client.example/${atCapPath}`] });
    assert.ok('client' in ok);
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

  it('rejects a code_verifier shorter than 43 chars (RFC 7636), even if the hash would match', async () => {
    const s = memoryStore();
    const client = await registerOk(s);
    const shortVerifier = 'too-short-verifier'; // < 43 chars
    const shortChallenge = createHash('sha256').update(shortVerifier).digest('base64url');
    const code = await createAuthCode(s, {
      uid: 'user-1', clientId: client.id, redirectUri: 'https://client.example/cb', codeChallenge: shortChallenge,
    });
    const result = await exchangeCode(s, {
      code, clientId: client.id, redirectUri: 'https://client.example/cb', codeVerifier: shortVerifier,
    });
    assert.ok('error' in result);
  });

  it('rejects a code_verifier with illegal characters (RFC 7636 charset), even if the hash would match', async () => {
    const s = memoryStore();
    const client = await registerOk(s);
    const illegalVerifier = 'a'.repeat(40) + ' +/='; // 44 chars, contains space/+//=
    const illegalChallenge = createHash('sha256').update(illegalVerifier).digest('base64url');
    const code = await createAuthCode(s, {
      uid: 'user-1', clientId: client.id, redirectUri: 'https://client.example/cb', codeChallenge: illegalChallenge,
    });
    const result = await exchangeCode(s, {
      code, clientId: client.id, redirectUri: 'https://client.example/cb', codeVerifier: illegalVerifier,
    });
    assert.ok('error' in result);
  });

  it('still accepts a valid-length, valid-charset verifier (class-wide proof the RFC check is not overzealous)', async () => {
    const s = memoryStore();
    const client = await registerOk(s);
    const code = await createAuthCode(s, {
      uid: 'user-1', clientId: client.id, redirectUri: 'https://client.example/cb', codeChallenge: challenge,
    });
    const result = await exchangeCode(s, {
      code, clientId: client.id, redirectUri: 'https://client.example/cb', codeVerifier: verifier,
    });
    assert.ok(!('error' in result));
  });

  it('concurrent exchangeCode calls on the same code: exactly one TokenPair, one error', async () => {
    const s = memoryStore();
    const client = await registerOk(s);
    const code = await createAuthCode(s, {
      uid: 'user-1', clientId: client.id, redirectUri: 'https://client.example/cb', codeChallenge: challenge,
    });
    const opts = { code, clientId: client.id, redirectUri: 'https://client.example/cb', codeVerifier: verifier };
    const [a, b] = await Promise.all([exchangeCode(s, opts), exchangeCode(s, opts)]);
    const results = [a, b];
    const successes = results.filter((r) => !('error' in r));
    const errors = results.filter((r) => 'error' in r);
    assert.equal(successes.length, 1);
    assert.equal(errors.length, 1);
  });

  it('concurrent refreshAccess calls on the same refresh secret: exactly one success', async () => {
    const s = memoryStore();
    const client = await registerOk(s);
    const code = await createAuthCode(s, {
      uid: 'user-1', clientId: client.id, redirectUri: 'https://client.example/cb', codeChallenge: challenge,
    });
    const first = await exchangeCode(s, {
      code, clientId: client.id, redirectUri: 'https://client.example/cb', codeVerifier: verifier,
    });
    if ('error' in first) throw new Error('setup exchange failed');
    const refreshOpts = { refreshSecret: first.refresh_token, clientId: client.id };
    const [a, b] = await Promise.all([refreshAccess(s, refreshOpts), refreshAccess(s, refreshOpts)]);
    const results = [a, b];
    const successes = results.filter((r) => !('error' in r));
    const errors = results.filter((r) => 'error' in r);
    assert.equal(successes.length, 1);
    assert.equal(errors.length, 1);
  });

  describe('store.claim primitive', () => {
    it('returns null for a missing doc', async () => {
      const s = memoryStore();
      assert.equal(await s.claim('some_col', 'nope', 'usedAt'), null);
    });

    it('claims once, then returns null on a second claim', async () => {
      const s = memoryStore();
      await s.set('some_col', 'doc-1', { foo: 'bar' });
      const first = await s.claim('some_col', 'doc-1', 'usedAt');
      assert.deepEqual(first, { foo: 'bar' });
      const second = await s.claim('some_col', 'doc-1', 'usedAt');
      assert.equal(second, null);
    });
  });

  describe('memoryStore dotted-key divergence guard (FOLDED review fix) — Firestore reads a "." in a key as a nested-field path, memoryStore does not', () => {
    it('throws on update() when a patch key contains a "."', async () => {
      const s = memoryStore();
      await s.set('some_col', 'doc-1', { foo: 'bar' });
      await assert.rejects(
        () => s.update('some_col', 'doc-1', { 'a.b': 1 }),
        /contains '\.'/,
      );
    });

    it('throws on claim() when the field name contains a "."', async () => {
      const s = memoryStore();
      await s.set('some_col', 'doc-1', { foo: 'bar' });
      await assert.rejects(
        () => s.claim('some_col', 'doc-1', 'a.b'),
        /contains '\.'/,
      );
    });

    it('does not throw for an ordinary, dot-free key (class-wide proof the guard is not overzealous)', async () => {
      const s = memoryStore();
      await s.set('some_col', 'doc-1', { foo: 'bar' });
      await assert.doesNotReject(() => s.update('some_col', 'doc-1', { foo: 'baz' }));
      await assert.doesNotReject(() => s.claim('some_col', 'doc-1', 'usedAt'));
    });
  });

  describe('AGENT.issuer() — decoupled from the SEO domain (NEXT_PUBLIC_SITE_URL)', () => {
    it('ignores NEXT_PUBLIC_SITE_URL entirely and falls back to its own default', () => {
      // The default moved intervu.cc -> intervuhq.com on 2026-08-24, then
      // intervuhq.com -> velai.app on 2026-08-29 (see AGENT.issuer()'s
      // docblock). Pointing NEXT_PUBLIC_SITE_URL at a THIRD, unrelated origin
      // is what makes this a decoupling test: asserting the issuer equals the
      // SEO domain while the SEO domain IS the default would pass just as
      // happily if the two were wired together.
      const savedIssuer = process.env.AGENT_ISSUER_URL;
      const savedSite = process.env.NEXT_PUBLIC_SITE_URL;
      delete process.env.AGENT_ISSUER_URL;
      process.env.NEXT_PUBLIC_SITE_URL = 'https://seo-canonical.example';
      try {
        assert.equal(AGENT.issuer(), 'https://velai.app');
      } finally {
        if (savedIssuer === undefined) delete process.env.AGENT_ISSUER_URL; else process.env.AGENT_ISSUER_URL = savedIssuer;
        if (savedSite === undefined) delete process.env.NEXT_PUBLIC_SITE_URL; else process.env.NEXT_PUBLIC_SITE_URL = savedSite;
      }
    });

    it('returns AGENT_ISSUER_URL when it is explicitly set', () => {
      const savedIssuer = process.env.AGENT_ISSUER_URL;
      process.env.AGENT_ISSUER_URL = 'https://agent-staging.example';
      try {
        assert.equal(AGENT.issuer(), 'https://agent-staging.example');
      } finally {
        if (savedIssuer === undefined) delete process.env.AGENT_ISSUER_URL; else process.env.AGENT_ISSUER_URL = savedIssuer;
      }
    });
  });
});

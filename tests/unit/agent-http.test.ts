import { describe, it } from 'node:test'; import assert from 'node:assert/strict';
import { extractBearerToken, extractBasicClientId } from '../../src/lib/agent/http';

describe('bearer extraction', () => {
  it('reads the token out of a well-formed Bearer header', () => {
    const req = new Request('http://x', { headers: { authorization: 'Bearer abc123' } });
    assert.equal(extractBearerToken(req), 'abc123');
  });
  it('is scheme-case-insensitive', () => {
    const req = new Request('http://x', { headers: { authorization: 'bearer abc123' } });
    assert.equal(extractBearerToken(req), 'abc123');
  });
  it('returns undefined with no Authorization header', () => {
    assert.equal(extractBearerToken(new Request('http://x')), undefined);
  });
  it('returns undefined for a non-Bearer scheme', () => {
    const req = new Request('http://x', { headers: { authorization: 'Basic abc123' } });
    assert.equal(extractBearerToken(req), undefined);
  });
  it('returns undefined for a Bearer scheme with no token', () => {
    const req = new Request('http://x', { headers: { authorization: 'Bearer' } });
    assert.equal(extractBearerToken(req), undefined);
  });
});

describe('Basic client id extraction (client_secret_basic at the token endpoint)', () => {
  const basic = (credentials: string) => new Request('http://x', { headers: { authorization: `Basic ${btoa(credentials)}` } });

  it('reads the id out of id:secret', () => {
    assert.equal(extractBasicClientId(basic('abc123:s3cret')), 'abc123');
  });
  it('reads the id when the secret is empty', () => {
    assert.equal(extractBasicClientId(basic('abc123:')), 'abc123');
  });
  it('reads the id when there is no colon at all', () => {
    assert.equal(extractBasicClientId(basic('abc123')), 'abc123');
  });
  it('form-decodes the id (RFC 6749 §2.3.1)', () => {
    assert.equal(extractBasicClientId(basic('a%20b+c:x')), 'a b c');
  });
  it('is scheme-case-insensitive', () => {
    const req = new Request('http://x', { headers: { authorization: `basic ${btoa('abc123:x')}` } });
    assert.equal(extractBasicClientId(req), 'abc123');
  });
  it('returns undefined with no header, a Bearer header, an empty id, or garbage', () => {
    assert.equal(extractBasicClientId(new Request('http://x')), undefined);
    assert.equal(extractBasicClientId(new Request('http://x', { headers: { authorization: 'Bearer abc123' } })), undefined);
    assert.equal(extractBasicClientId(basic(':secret')), undefined);
    assert.equal(extractBasicClientId(new Request('http://x', { headers: { authorization: 'Basic !!!not-base64!!!' } })), undefined);
    assert.equal(extractBasicClientId(new Request('http://x', { headers: { authorization: 'Basic' } })), undefined);
  });
});

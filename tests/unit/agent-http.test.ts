import { describe, it } from 'node:test'; import assert from 'node:assert/strict';
import { extractBearerToken } from '../../src/lib/agent/http';

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

import { describe, it } from 'node:test'; import assert from 'node:assert/strict';
import {
  extractBearerToken, unauthorizedResponse, rateLimitedResponse, toolResult, AUTHORIZED_CREDENTIAL_KINDS,
} from '../../src/app/api/mcp/route';
import { AGENT } from '../../src/lib/agent/config';

describe('mcp route: bearer extraction', () => {
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

describe('mcp route: 401/429 wire contract', () => {
  it('unauthorizedResponse carries the exact body and WWW-Authenticate challenge', async () => {
    const res = unauthorizedResponse();
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'unauthorized' });
    assert.equal(
      res.headers.get('WWW-Authenticate'),
      `Bearer resource_metadata="${AGENT.issuer()}/.well-known/oauth-protected-resource"`
    );
  });
  it('rateLimitedResponse carries Retry-After in seconds', async () => {
    const res = rateLimitedResponse(42);
    assert.equal(res.status, 429);
    assert.equal(res.headers.get('Retry-After'), '42');
    assert.deepEqual(await res.json(), { error: 'rate_limited' });
  });
});

describe('mcp route: credential-kind gate (CARRIED FINDING, Task 6)', () => {
  it('authorizes manual and access credentials', () => {
    assert.equal(AUTHORIZED_CREDENTIAL_KINDS.has('manual'), true);
    assert.equal(AUTHORIZED_CREDENTIAL_KINDS.has('access'), true);
  });
  it('does not authorize a refresh credential', () => {
    assert.equal(AUTHORIZED_CREDENTIAL_KINDS.has('refresh'), false);
  });
});

describe('mcp route: tool result wire wrapping', () => {
  it('wraps a plain success payload without isError', () => {
    const result = toolResult({ hits: [], total: 0 });
    assert.equal(result.isError, undefined);
    assert.deepEqual(JSON.parse(result.content[0].text), { hits: [], total: 0 });
  });
  it('flags isError when the payload carries an error key', () => {
    const result = toolResult({ error: 'job not found' });
    assert.equal(result.isError, true);
    assert.deepEqual(JSON.parse(result.content[0].text), { error: 'job not found' });
  });
});

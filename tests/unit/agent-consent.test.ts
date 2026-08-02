import { describe, it } from 'node:test'; import assert from 'node:assert/strict';
import { memoryStore } from '../../src/lib/agent/store';
import { registerClient } from '../../src/lib/agent/oauth';
import { validateConsentShape, validateConsentRequest } from '../../src/lib/agent/consent';

const validShape = {
  client_id: 'c1',
  redirect_uri: 'https://client.example/cb',
  code_challenge: 'a-challenge',
  code_challenge_method: 'S256',
  response_type: 'code',
};

describe('validateConsentShape (pure)', () => {
  it('accepts a fully-formed request', () => {
    const result = validateConsentShape(validShape);
    assert.equal(result.ok, true);
  });

  it('rejects a missing client_id', () => {
    const result = validateConsentShape({ ...validShape, client_id: undefined });
    assert.equal(result.ok, false);
  });

  it('rejects a missing redirect_uri', () => {
    const result = validateConsentShape({ ...validShape, redirect_uri: undefined });
    assert.equal(result.ok, false);
  });

  it('rejects a missing code_challenge', () => {
    const result = validateConsentShape({ ...validShape, code_challenge: undefined });
    assert.equal(result.ok, false);
  });

  it('rejects response_type other than "code"', () => {
    const result = validateConsentShape({ ...validShape, response_type: 'token' });
    assert.equal(result.ok, false);
  });

  it('rejects code_challenge_method other than "S256"', () => {
    const result = validateConsentShape({ ...validShape, code_challenge_method: 'plain' });
    assert.equal(result.ok, false);
  });

  it('carries state through untouched when present', () => {
    const result = validateConsentShape({ ...validShape, state: 'xyz' });
    if (!result.ok) throw new Error('expected ok');
    assert.equal(result.params.state, 'xyz');
  });
});

describe('validateConsentRequest (store-backed)', () => {
  it('rejects an unknown client_id', async () => {
    const store = memoryStore();
    const result = await validateConsentRequest(store, validShape);
    assert.equal(result.ok, false);
  });

  it('rejects a redirect_uri not registered to the client', async () => {
    const store = memoryStore();
    const reg = await registerClient(store, { redirect_uris: ['https://client.example/cb'] });
    if ('error' in reg) throw new Error('registerClient failed');
    const result = await validateConsentRequest(store, { ...validShape, client_id: reg.client.id, redirect_uri: 'https://evil.example/cb' });
    assert.equal(result.ok, false);
  });

  it('accepts a registered client + matching redirect_uri', async () => {
    const store = memoryStore();
    const reg = await registerClient(store, { client_name: 'Test Client', redirect_uris: ['https://client.example/cb'] });
    if ('error' in reg) throw new Error('registerClient failed');
    const result = await validateConsentRequest(store, { ...validShape, client_id: reg.client.id, redirect_uri: 'https://client.example/cb' });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.client.name, 'Test Client');
  });
});

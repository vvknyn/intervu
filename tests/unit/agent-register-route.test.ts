import { describe, it, beforeEach } from 'node:test'; import assert from 'node:assert/strict';
import { memoryStore } from '../../src/lib/agent/store';
import { registerClient } from '../../src/lib/agent/oauth';
import { AGENT } from '../../src/lib/agent/config';
import { _resetRateLimits } from '../../src/lib/agent/rate-limit';
import { sanitizeClientName, POST } from '../../src/app/api/oauth/register/route';

describe('sanitizeClientName (pure) — DCR body.client_name is attacker-controlled JSON', () => {
  it('rejects an object (proves it, not just documents it)', () => {
    assert.equal(sanitizeClientName({ toString: () => 'evil' }), undefined);
  });

  it('rejects an array', () => {
    assert.equal(sanitizeClientName(['a', 'b']), undefined);
  });

  it('rejects a number', () => {
    assert.equal(sanitizeClientName(42), undefined);
  });

  it('rejects an empty/whitespace-only string', () => {
    assert.equal(sanitizeClientName('   '), undefined);
  });

  it('rejects null and undefined', () => {
    assert.equal(sanitizeClientName(null), undefined);
    assert.equal(sanitizeClientName(undefined), undefined);
  });

  it('trims and keeps a valid string', () => {
    assert.equal(sanitizeClientName('  My Agent  '), 'My Agent');
  });

  it('truncates (does not reject) a name past MAX_CLIENT_NAME_LENGTH', () => {
    const huge = 'A'.repeat(AGENT.MAX_CLIENT_NAME_LENGTH + 500);
    const result = sanitizeClientName(huge);
    assert.equal(result?.length, AGENT.MAX_CLIENT_NAME_LENGTH);
    assert.equal(result, 'A'.repeat(AGENT.MAX_CLIENT_NAME_LENGTH));
  });

  it('keeps a name exactly at MAX_CLIENT_NAME_LENGTH untouched', () => {
    const atCap = 'B'.repeat(AGENT.MAX_CLIENT_NAME_LENGTH);
    assert.equal(sanitizeClientName(atCap), atCap);
  });
});

describe('register route + registerClient integration — stored name is always a string', () => {
  const cases: Array<{ label: string; input: unknown }> = [
    { label: 'object client_name', input: { malicious: true } },
    { label: 'number client_name', input: 12345 },
    { label: 'valid string client_name', input: 'Legit Agent' },
  ];

  for (const { label, input } of cases) {
    it(`${label} -> registration succeeds with a string name`, async () => {
      const store = memoryStore();
      const result = await registerClient(store, {
        client_name: sanitizeClientName(input),
        redirect_uris: ['https://client.example/cb'],
      });
      if ('error' in result) throw new Error(`registerClient failed: ${result.error}`);
      assert.equal(typeof result.client.name, 'string');
      if (label === 'valid string client_name') {
        assert.equal(result.client.name, 'Legit Agent');
      } else {
        // Non-string input is treated as absent — falls back to registerClient's default.
        assert.equal(result.client.name, 'Unnamed client');
      }
    });
  }
});

describe('POST /api/oauth/register — per-IP rate limit (public, unauthenticated endpoint)', () => {
  beforeEach(() => { _resetRateLimits(); });

  // Deliberately invalid body (no redirect_uris) — the request never reaches
  // `registerClient`/Firestore, so the rate-limit gate is exercised in
  // isolation from storage.
  function reqFrom(ip: string): Request {
    return new Request('http://x/api/oauth/register', {
      method: 'POST',
      headers: { 'x-forwarded-for': ip, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
  }

  it('429s after AGENT.RATE_LIMIT requests from the same IP', async () => {
    const ip = '198.51.100.10';
    for (let i = 0; i < AGENT.RATE_LIMIT; i++) {
      const res = await POST(reqFrom(ip));
      assert.equal(res.status, 400, `request ${i + 1} should still be under budget`);
    }
    const limited = await POST(reqFrom(ip));
    assert.equal(limited.status, 429);
    assert.deepEqual(await limited.json(), { error: 'rate_limited' });
  });

  it('does not share budget across different caller IPs (keyed by IP, not global)', async () => {
    const ipA = '198.51.100.20';
    for (let i = 0; i < AGENT.RATE_LIMIT; i++) await POST(reqFrom(ipA));
    assert.equal((await POST(reqFrom(ipA))).status, 429);

    const ipB = '198.51.100.21';
    assert.equal((await POST(reqFrom(ipB))).status, 400);
  });
});

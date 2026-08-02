import { describe, it } from 'node:test'; import assert from 'node:assert/strict';
import { memoryStore } from '../../src/lib/agent/store';
import { registerClient } from '../../src/lib/agent/oauth';
import { sanitizeClientName } from '../../src/app/api/oauth/register/route';

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

import { describe, it } from 'node:test'; import assert from 'node:assert/strict';
import { isCredentialActive, toActiveCredentialSummaries } from '../../src/lib/agent/tokens';
import type { Credential } from '../../src/lib/agent/tokens';

function row(overrides: Partial<Omit<Credential, 'tokenHash'>>): Omit<Credential, 'tokenHash'> {
  return {
    id: 'c1',
    uid: 'u1',
    kind: 'manual',
    clientId: null,
    clientName: null,
    createdAt: 1000,
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
    ...overrides,
  };
}

describe('isCredentialActive (pure)', () => {
  it('is active with no revokedAt/expiresAt', () => {
    assert.equal(isCredentialActive({ revokedAt: null, expiresAt: null }), true);
  });
  it('is inactive once revoked', () => {
    assert.equal(isCredentialActive({ revokedAt: 500, expiresAt: null }), false);
  });
  it('is inactive once past its TTL', () => {
    assert.equal(isCredentialActive({ revokedAt: null, expiresAt: 100 }, 200), false);
  });
  it('is active before its TTL', () => {
    assert.equal(isCredentialActive({ revokedAt: null, expiresAt: 300 }, 200), true);
  });
});

describe('toActiveCredentialSummaries (pure) — the Settings "Connected agents" projection', () => {
  it('drops tokenHash-adjacent internals and keeps only the wire-safe fields, class-wide (not just the manual-token case)', () => {
    const rows = [
      row({ id: 'manual-1', kind: 'manual', clientName: null, createdAt: 10, lastUsedAt: 20 }),
      row({ id: 'oauth-1', kind: 'access', clientId: 'client-a', clientName: 'Some Client', createdAt: 30, lastUsedAt: null }),
    ];
    const out = toActiveCredentialSummaries(rows);
    assert.deepEqual(out, [
      { id: 'manual-1', kind: 'manual', clientName: null, createdAt: 10, lastUsedAt: 20 },
      { id: 'client-a', kind: 'oauth', clientName: 'Some Client', createdAt: 30, lastUsedAt: null },
    ]);
    for (const summary of out) {
      assert.equal('tokenHash' in summary, false);
      assert.equal('uid' in summary, false);
      assert.equal('clientId' in summary, false);
    }
  });

  it('excludes revoked credentials — a revoked row must not still read as "connected"', () => {
    const rows = [row({ id: 'revoked-1', revokedAt: 999 })];
    assert.deepEqual(toActiveCredentialSummaries(rows), []);
  });

  it('excludes expired credentials even when never explicitly revoked (e.g. a stale access token left behind by refresh rotation)', () => {
    const rows = [row({ id: 'expired-1', kind: 'access', expiresAt: 100 })];
    assert.deepEqual(toActiveCredentialSummaries(rows, 200), []);
  });

  it('returns an empty list for a user with no credentials', () => {
    assert.deepEqual(toActiveCredentialSummaries([]), []);
  });

  it('CRITICAL 2 — groups an access+refresh pair sharing one clientId into ONE oauth row, not two', () => {
    const rows = [
      row({ id: 'access-1', kind: 'access', clientId: 'client-a', clientName: 'Claude', createdAt: 100, lastUsedAt: 500 }),
      row({ id: 'refresh-1', kind: 'refresh', clientId: 'client-a', clientName: 'Claude', createdAt: 100, lastUsedAt: null }),
    ];
    const out = toActiveCredentialSummaries(rows);
    assert.equal(out.length, 1);
    assert.deepEqual(out[0], { id: 'client-a', kind: 'oauth', clientName: 'Claude', createdAt: 100, lastUsedAt: 500 });
  });

  it('groups a rotated refresh pair (a SECOND access+refresh row from a later refresh) under the SAME clientId, taking earliest createdAt and max lastUsedAt', () => {
    const rows = [
      row({ id: 'access-1', kind: 'access', clientId: 'client-a', clientName: 'Claude', createdAt: 100, lastUsedAt: 200 }),
      row({ id: 'refresh-1', kind: 'refresh', clientId: 'client-a', clientName: 'Claude', createdAt: 100, lastUsedAt: null }),
      row({ id: 'access-2', kind: 'access', clientId: 'client-a', clientName: 'Claude', createdAt: 400, lastUsedAt: 900 }),
      row({ id: 'refresh-2', kind: 'refresh', clientId: 'client-a', clientName: 'Claude', createdAt: 400, lastUsedAt: null }),
    ];
    const out = toActiveCredentialSummaries(rows);
    assert.equal(out.length, 1);
    assert.deepEqual(out[0], { id: 'client-a', kind: 'oauth', clientName: 'Claude', createdAt: 100, lastUsedAt: 900 });
  });

  it('keeps distinct clients as distinct rows, and a manual token alongside them as its own row', () => {
    const rows = [
      row({ id: 'manual-1', kind: 'manual', clientName: null, createdAt: 5, lastUsedAt: null }),
      row({ id: 'access-a', kind: 'access', clientId: 'client-a', clientName: 'Claude', createdAt: 10, lastUsedAt: null }),
      row({ id: 'refresh-a', kind: 'refresh', clientId: 'client-a', clientName: 'Claude', createdAt: 10, lastUsedAt: null }),
      row({ id: 'access-b', kind: 'access', clientId: 'client-b', clientName: 'ChatGPT', createdAt: 20, lastUsedAt: null }),
      row({ id: 'refresh-b', kind: 'refresh', clientId: 'client-b', clientName: 'ChatGPT', createdAt: 20, lastUsedAt: null }),
    ];
    const out = toActiveCredentialSummaries(rows);
    assert.equal(out.length, 3);
    assert.deepEqual(out.map((s) => s.id).sort(), ['client-a', 'client-b', 'manual-1']);
  });
});

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
      { id: 'oauth-1', kind: 'access', clientName: 'Some Client', createdAt: 30, lastUsedAt: null },
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
});

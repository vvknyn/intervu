import { describe, it } from 'node:test'; import assert from 'node:assert/strict';
import { memoryStore } from '../../src/lib/agent/store';
import { issueCredential, verifySecret, revokeCredential, listCredentials, hashSecret } from '../../src/lib/agent/tokens';
describe('agent tokens', () => {
  it('issues and verifies a manual token', async () => {
    const s = memoryStore();
    const { credential, secret } = await issueCredential(s, { uid: 'u1', kind: 'manual' });
    assert.match(secret, /^ivu_[A-Za-z0-9_-]+$/);
    assert.equal(credential.tokenHash, hashSecret(secret));
    const v = await verifySecret(s, secret);
    assert.equal(v?.uid, 'u1');
  });
  it('rejects wrong, revoked, and expired secrets', async () => {
    const s = memoryStore();
    const { credential, secret } = await issueCredential(s, { uid: 'u1', kind: 'access', ttlMs: -1 });
    assert.equal(await verifySecret(s, secret), null);            // already expired
    const m = await issueCredential(s, { uid: 'u1', kind: 'manual' });
    assert.equal(await verifySecret(s, 'ivu_nope'), null);
    assert.equal(await revokeCredential(s, 'u1', m.credential.id), true);
    assert.equal(await verifySecret(s, m.secret), null);
  });
  it('revoke enforces uid ownership; list excludes hash', async () => {
    const s = memoryStore();
    const m = await issueCredential(s, { uid: 'u1', kind: 'manual' });
    assert.equal(await revokeCredential(s, 'attacker', m.credential.id), false);
    const rows = await listCredentials(s, 'u1');
    assert.equal(rows.length, 1);
  });
  it('issues distinct-prefixed secrets and verifies across all three kinds', async () => {
    const s = memoryStore();
    const access = await issueCredential(s, { uid: 'u2', kind: 'access' });
    const refresh = await issueCredential(s, { uid: 'u2', kind: 'refresh' });
    assert.match(access.secret, /^iva_[A-Za-z0-9_-]+$/);
    assert.match(refresh.secret, /^ivr_[A-Za-z0-9_-]+$/);
    assert.equal((await verifySecret(s, access.secret))?.kind, 'access');
    assert.equal((await verifySecret(s, refresh.secret))?.kind, 'refresh');
  });
  it('tracks lastUsedAt after verification without changing the return value', async () => {
    const s = memoryStore();
    const { credential, secret } = await issueCredential(s, { uid: 'u3', kind: 'manual' });
    assert.equal(credential.lastUsedAt, null);
    const v = await verifySecret(s, secret);
    assert.equal(v?.lastUsedAt, null); // returned value reflects pre-update state
    const stored = (await listCredentials(s, 'u3'))[0];
    assert.notEqual(stored.lastUsedAt, null);
  });
});

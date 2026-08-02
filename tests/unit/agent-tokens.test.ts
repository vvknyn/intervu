import { describe, it } from 'node:test'; import assert from 'node:assert/strict';
import { memoryStore } from '../../src/lib/agent/store';
import { issueCredential, verifySecret, revokeCredential, revokeByClient, listCredentials, hashSecret } from '../../src/lib/agent/tokens';
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
    assert.equal('tokenHash' in rows[0], false);
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

  describe('revokeByClient — CRITICAL 2, disconnecting a whole OAuth client, not one row', () => {
    it('kills BOTH the access and refresh row for the client, leaving an unrelated manual token alive', async () => {
      const s = memoryStore();
      const access = await issueCredential(s, { uid: 'u4', kind: 'access', clientId: 'client-a', clientName: 'Claude' });
      const refresh = await issueCredential(s, { uid: 'u4', kind: 'refresh', clientId: 'client-a', clientName: 'Claude' });
      const manual = await issueCredential(s, { uid: 'u4', kind: 'manual' });

      const count = await revokeByClient(s, 'u4', 'client-a');
      assert.equal(count, 2);
      assert.equal(await verifySecret(s, access.secret), null);
      assert.equal(await verifySecret(s, refresh.secret), null);
      assert.notEqual(await verifySecret(s, manual.secret), null);
    });

    it('enforces uid ownership — a different uid revokes nothing', async () => {
      const s = memoryStore();
      const access = await issueCredential(s, { uid: 'u5', kind: 'access', clientId: 'client-b', clientName: 'ChatGPT' });
      const count = await revokeByClient(s, 'attacker', 'client-b');
      assert.equal(count, 0);
      assert.notEqual(await verifySecret(s, access.secret), null);
    });

    it('returns 0 for a clientId the uid has no credentials under', async () => {
      const s = memoryStore();
      await issueCredential(s, { uid: 'u6', kind: 'manual' });
      assert.equal(await revokeByClient(s, 'u6', 'no-such-client'), 0);
    });
  });
});

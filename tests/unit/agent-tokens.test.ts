import { describe, it } from 'node:test'; import assert from 'node:assert/strict';
import { memoryStore } from '../../src/lib/agent/store';
import { issueCredential, verifySecret, revokeCredential, revokeByClient, listCredentials, hashSecret, toActiveCredentialSummaries, AUTHORIZED_CREDENTIAL_KINDS } from '../../src/lib/agent/tokens';
import { AGENT, trimAndCapLabel } from '../../src/lib/agent/config';

describe('credential-kind gate (CARRIED FINDING, Task 6)', () => {
  it('authorizes manual and access credentials', () => {
    assert.equal(AUTHORIZED_CREDENTIAL_KINDS.has('manual'), true);
    assert.equal(AUTHORIZED_CREDENTIAL_KINDS.has('access'), true);
  });
  it('does not authorize a refresh credential', () => {
    assert.equal(AUTHORIZED_CREDENTIAL_KINDS.has('refresh'), false);
  });
});

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

describe('manual token labels (Settings "Connected agents" create-token input)', () => {
  it('round-trips a label through issueCredential, the store, and the summary projection', async () => {
    const s = memoryStore();
    const clientName = trimAndCapLabel('Laptop Claude Code', AGENT.MAX_TOKEN_LABEL_LENGTH);
    const { credential } = await issueCredential(s, { uid: 'u7', kind: 'manual', clientName });
    assert.equal(credential.clientName, 'Laptop Claude Code');
    const rows = await listCredentials(s, 'u7');
    assert.equal(rows[0].clientName, 'Laptop Claude Code');
    const [summary] = toActiveCredentialSummaries(rows);
    assert.equal(summary.clientName, 'Laptop Claude Code');
  });

  it('caps an over-long label at MAX_TOKEN_LABEL_LENGTH rather than rejecting it', () => {
    const huge = 'A'.repeat(AGENT.MAX_TOKEN_LABEL_LENGTH + 25);
    const capped = trimAndCapLabel(huge, AGENT.MAX_TOKEN_LABEL_LENGTH);
    assert.equal(capped?.length, AGENT.MAX_TOKEN_LABEL_LENGTH);
    assert.equal(capped, 'A'.repeat(AGENT.MAX_TOKEN_LABEL_LENGTH));
  });

  it('an empty/whitespace-only label yields undefined, so a manual credential falls back to its kind-based display', async () => {
    assert.equal(trimAndCapLabel('   ', AGENT.MAX_TOKEN_LABEL_LENGTH), undefined);
    assert.equal(trimAndCapLabel('', AGENT.MAX_TOKEN_LABEL_LENGTH), undefined);

    const s = memoryStore();
    const clientName = trimAndCapLabel('   ', AGENT.MAX_TOKEN_LABEL_LENGTH);
    const { credential } = await issueCredential(s, { uid: 'u8', kind: 'manual', clientName });
    assert.equal(credential.clientName, null); // toCredential coerces the absent field to null, same as an unlabeled token today
  });

  it('does not disturb an OAuth credential\'s own clientName — a different actor (the client app), same field, unrelated cap', async () => {
    const s = memoryStore();
    const { credential } = await issueCredential(s, { uid: 'u9', kind: 'access', clientId: 'client-c', clientName: 'Claude Desktop' });
    assert.equal(credential.clientName, 'Claude Desktop');
  });
});

describe('trimAndCapLabel — output must be storage-valid text (jsonb), not just character-counted', () => {
  it('keeps an emoji intact when it lands exactly on the code-point cap, never a lone surrogate', () => {
    const input = 'A'.repeat(39) + '😀';
    const result = trimAndCapLabel(input, 40);
    assert.equal(result?.isWellFormed(), true);
    assert.equal(Array.from(result ?? '').length, 40);
    assert.ok(!JSON.stringify(result).includes('\\ud'));
  });

  it('strips control characters and a lone surrogate rather than storing them', () => {
    assert.equal(trimAndCapLabel('lap\u0000top\ud83d\tX', 40), 'laptopX');
  });

  it('trims whitespace exposed by the code-point cap', () => {
    const input = 'A'.repeat(39) + ' B';
    assert.equal(trimAndCapLabel(input, 40), 'A'.repeat(39));
  });

  it('caps CJK by code point, not UTF-16 unit', () => {
    assert.equal(trimAndCapLabel('語'.repeat(40), 40), '語'.repeat(40));
    assert.equal(trimAndCapLabel('語'.repeat(41), 40)?.length, 40);
  });
});

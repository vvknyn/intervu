import { describe, it } from 'node:test'; import assert from 'node:assert/strict';
import { signalUrl, pollUntilGuest } from '../../openclaw/scripts/viewer/transport-webrtc.mjs';
import { pickAccessToken } from '../../openclaw/scripts/viewer/mcporter-token.mjs';

describe('signalUrl', () => {
  it('builds the signaling path for a session', () => {
    assert.equal(signalUrl('https://intervu.cc', 'abc'), 'https://intervu.cc/api/viewer/session/abc/signal');
  });
  it('tolerates a trailing slash on the base', () => {
    assert.equal(signalUrl('https://intervu.cc/', 'abc'), 'https://intervu.cc/api/viewer/session/abc/signal');
  });
});

describe('pollUntilGuest', () => {
  it('returns the guest blob as soon as it appears', async () => {
    let n = 0;
    const fake = async () => ({ ok: true, json: async () => (++n < 3 ? { guest: null } : { guest: { sdp: 'v=0' } }) });
    const guest = await pollUntilGuest(fake as unknown as typeof fetch, 'u', { attempts: 10, delayMs: 0 });
    assert.equal(guest.sdp, 'v=0');
    assert.equal(n, 3, 'must stop polling the moment the phone answers');
  });

  it('gives up after the attempt budget rather than hanging forever', async () => {
    const fake = async () => ({ ok: true, json: async () => ({ guest: null }) });
    await assert.rejects(
      () => pollUntilGuest(fake as unknown as typeof fetch, 'u', { attempts: 3, delayMs: 0 }),
      (e: Error) => /never connected/i.test(e.message),
    );
  });

  it('keeps waiting through a transient server error instead of aborting the session', async () => {
    // The phone may take a minute to be picked up. One 503 from a redeploy
    // must not end a watch session that would otherwise have worked.
    let n = 0;
    const fake = async () => (++n === 1
      ? { ok: false, status: 503, json: async () => ({}) }
      : { ok: true, json: async () => ({ guest: { sdp: 'v=0' } }) });
    const guest = await pollUntilGuest(fake as unknown as typeof fetch, 'u', { attempts: 5, delayMs: 0 });
    assert.equal(guest.sdp, 'v=0');
  });
});

describe('pickAccessToken', () => {
  // mcporter keys entries by "<serverName>|<hash>", so the key cannot be
  // predicted and the serverName field is what must be matched on.
  const creds = {
    version: 1,
    entries: {
      'other-server|aaa': { serverName: 'other-server', tokens: { access_token: 'nope', token_type: 'Bearer' } },
      'intervu-cc-mcp|81b594f5': { serverName: 'intervu-cc-mcp', tokens: { access_token: 'iva_real', token_type: 'Bearer' } },
    },
  };

  it('finds the token by server name, not by entry key', () => {
    assert.equal(pickAccessToken(creds, 'intervu-cc-mcp'), 'iva_real');
  });

  it('returns null when that server has no entry', () => {
    assert.equal(pickAccessToken(creds, 'not-registered'), null);
  });

  it('returns null rather than guessing when the file has an unexpected shape', () => {
    assert.equal(pickAccessToken(null, 'intervu-cc-mcp'), null);
    assert.equal(pickAccessToken({}, 'intervu-cc-mcp'), null);
    assert.equal(pickAccessToken({ entries: { x: { serverName: 'intervu-cc-mcp' } } }, 'intervu-cc-mcp'), null);
  });
});

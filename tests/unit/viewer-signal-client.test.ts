import { describe, it } from 'node:test'; import assert from 'node:assert/strict';
import { signalUrl, pollUntilGuest, nextPollDelay, chunkPayload, CHUNK_BYTES } from '../../openclaw/scripts/viewer/transport-webrtc.mjs';
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
  const soon = () => Date.now() + 5_000;

  it('returns the guest blob as soon as it appears', async () => {
    let n = 0;
    const fake = async () => ({ ok: true, json: async () => (++n < 3 ? { guest: null } : { guest: { sdp: 'v=0' } }) });
    const guest = await pollUntilGuest(fake as unknown as typeof fetch, 'u', { deadline: soon(), delayMs: 0 });
    assert.equal(guest.sdp, 'v=0');
    assert.equal(n, 3, 'must stop polling the moment the phone answers');
  });

  it('waits for the whole session, not some shorter budget of its own', async () => {
    // The first version gave up after 60 attempts x 2s = 2 minutes on a
    // session that lives 15, so anyone slower than that to pick up their
    // phone got a link that could never connect. The deadline IS the
    // session's expiry, so the two cannot disagree.
    let calls = 0;
    const fake = async () => { calls++; return { ok: true, json: async () => ({ guest: null }) }; };
    const deadline = Date.now() + 120;
    await assert.rejects(
      () => pollUntilGuest(fake as unknown as typeof fetch, 'u', { deadline, delayMs: 10 }),
      (e: Error) => /expired/i.test(e.message),
    );
    assert.ok(Date.now() >= deadline, 'must keep polling right up to the deadline');
    assert.ok(calls > 3, `expected repeated polling, saw ${calls}`);
  });

  it('does not poll at all once the session has already expired', async () => {
    let calls = 0;
    const fake = async () => { calls++; return { ok: true, json: async () => ({ guest: null }) }; };
    await assert.rejects(
      () => pollUntilGuest(fake as unknown as typeof fetch, 'u', { deadline: Date.now() - 1, delayMs: 0 }),
      (e: Error) => /expired/i.test(e.message),
    );
    assert.equal(calls, 0);
  });

  it('backs off between polls instead of asking every two seconds for fifteen minutes', async () => {
    // ~450 flat-rate requests per session to learn "no" was the measured
    // cost. The ramp must grow AND stop growing at the cap.
    const slept: number[] = [];
    const fake = async () => ({ ok: true, json: async () => ({ guest: null }) });
    await assert.rejects(
      () => pollUntilGuest(fake as unknown as typeof fetch, 'u', {
        deadline: Date.now() + 1000,
        delayMs: 10, maxDelayMs: 50,
        sleepImpl: async (ms: number) => { slept.push(ms); if (slept.length >= 5) await new Promise((r) => setTimeout(r, 1100)); },
      }),
      (e: Error) => /expired/i.test(e.message),
    );
    assert.deepEqual(slept, [10, 20, 40, 50, 50]);
  });

  it('doubles toward the cap and never past it', () => {
    assert.equal(nextPollDelay(1000, 15000), 2000);
    assert.equal(nextPollDelay(8000, 15000), 15000);
    assert.equal(nextPollDelay(15000, 15000), 15000);
    assert.equal(nextPollDelay(0, 15000), 0);
  });

  it('keeps waiting through a THROWN fetch, not just a non-200', async () => {
    // Seen live: one network blip on the laptop ended a 15-minute wait with
    // "fetch failed" while the session sat valid on the doorbell. A throw
    // and a 503 must mean the same thing: not yet.
    let n = 0;
    const fake = async () => {
      if (++n === 1) throw new TypeError('fetch failed');
      return { ok: true, json: async () => ({ guest: { sdp: 'v=0' } }) };
    };
    const guest = await pollUntilGuest(fake as unknown as typeof fetch, 'u', { deadline: soon(), delayMs: 0 });
    assert.equal(guest.sdp, 'v=0');
  });

  it('skips a stale answer via ignoreSdp, then accepts a changed one', async () => {
    // Reconnect (D11) re-posts a fresh offer under the same session id; the
    // guest's PREVIOUS answer can still be sitting there for a moment, and
    // accepting it again would pair the host with a peer connection that no
    // longer exists.
    let n = 0;
    const fake = async () => {
      n++;
      return { ok: true, json: async () => ({ guest: { sdp: n < 3 ? 'stale-answer' : 'fresh-answer' } }) };
    };
    const guest = await pollUntilGuest(fake as unknown as typeof fetch, 'u', {
      deadline: soon(), delayMs: 0, ignoreSdp: 'stale-answer',
    });
    assert.equal(guest.sdp, 'fresh-answer');
    assert.ok(n >= 3, 'must keep polling past the stale answer rather than accepting it');
  });

  it('keeps waiting through a transient server error instead of aborting the session', async () => {
    // The phone may take a minute to be picked up. One 503 from a redeploy
    // must not end a watch session that would otherwise have worked.
    let n = 0;
    const fake = async () => (++n === 1
      ? { ok: false, status: 503, json: async () => ({}) }
      : { ok: true, json: async () => ({ guest: { sdp: 'v=0' } }) });
    const guest = await pollUntilGuest(fake as unknown as typeof fetch, 'u', { deadline: soon(), delayMs: 0 });
    assert.equal(guest.sdp, 'v=0');
  });
});

describe('chunkPayload', () => {
  // A real frame (142,255 bytes, seen live) exceeds the channel's negotiated
  // 65,536-byte message ceiling — a limit the REMOTE advertises, so it
  // cannot be configured away. Every piece must clear it with room.

  const reassemble = (pieces: string[]) => {
    // What the phone does: concatenate C-bodies until the F-body arrives.
    let whole = '';
    for (const piece of pieces) whole += piece.slice(1);
    return whole;
  };

  it('splits a frame-sized payload into pieces that each fit a message', () => {
    const payload = 'x'.repeat(142_255);
    const pieces = [...chunkPayload(payload)];
    for (const piece of pieces) assert.ok(piece.length <= CHUNK_BYTES + 1, `piece of ${piece.length} bytes`);
    assert.ok(pieces.length > 1);
    assert.equal(pieces.at(-1)![0], 'F');
    for (const piece of pieces.slice(0, -1)) assert.equal(piece[0], 'C');
    assert.equal(reassemble(pieces), payload);
  });

  it('sends a small payload as a single final piece', () => {
    assert.deepEqual([...chunkPayload('{"f":"AAAA"}')], ['F{"f":"AAAA"}']);
  });

  it('marks the last piece final even on an exact chunk boundary', () => {
    const payload = 'y'.repeat(CHUNK_BYTES * 2);
    const pieces = [...chunkPayload(payload)];
    assert.equal(pieces.length, 2);
    assert.equal(pieces[1][0], 'F');
    assert.equal(reassemble(pieces), payload);
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

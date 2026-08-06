import { describe, it } from 'node:test'; import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createWebRtcTransport } from '../../openclaw/scripts/viewer/transport-webrtc.mjs';

/**
 * werift is a dependency of the SKILL, not of this repo, so it resolves from
 * openclaw/node_modules — which is where the transport itself finds it.
 * Resolving from the transport's own directory rather than hardcoding that
 * path means this test loads exactly the copy the shipped code loads.
 */
async function loadWerift() {
  const require = createRequire(new URL('../../openclaw/scripts/viewer/', import.meta.url));
  return import(pathToFileURL(require.resolve('werift')).href);
}

/**
 * Drives the real peer connection with a second werift peer standing in for
 * the phone, so the part that cannot be checked by inspecting helpers — does
 * a frame actually arrive over the data channel — is checked.
 *
 * The doorbell is a fake here, but a faithful one: it stores and serves the
 * two SDPs exactly as the Firestore-backed routes do. What this does NOT
 * cover is the deployed doorbell and a real phone over cellular; that needs
 * hardware and a deploy.
 */

/** Stands in for /api/viewer/session and its /signal endpoint. */
function fakeDoorbell() {
  const state: { host: { sdp: string } | null; guest: { sdp: string } | null; deleted: boolean } = {
    host: null, guest: null, deleted: false,
  };
  const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

  const fetchImpl = async (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? 'GET';
    if (url.endsWith('/api/viewer/session') && method === 'POST') {
      // No watchUrl: the server cannot know the origin the phone should
      // dial, so the transport composes the link from the base it used.
      return json({ sessionId: 'sess-1', expiresAt: Date.now() + 60_000 });
    }
    if (method === 'POST') {
      const body = JSON.parse(init!.body!) as { role: 'host' | 'guest'; sdp: string };
      state[body.role] = { sdp: body.sdp };
      return json({ ok: true });
    }
    if (method === 'DELETE') { state.deleted = true; return json({ ok: true }); }
    return json({ host: state.host, guest: state.guest });
  };

  return { state, fetchImpl: fetchImpl as unknown as typeof fetch };
}

describe('WebRTC transport, end to end against a stand-in phone', () => {
  it('hands over a watch link before the phone answers, then streams to it', async (t) => {
    let RTCPeerConnection;
    try {
      ({ RTCPeerConnection } = await loadWerift());
    } catch {
      // Explicit, not silent: openclaw/node_modules is gitignored and
      // installed by install.sh, so a fresh checkout has not got it yet.
      return t.skip('werift not installed — run: npm i --prefix openclaw');
    }
    t.diagnostic('opens a real peer connection; a few seconds of ICE is expected');

    const doorbell = fakeDoorbell();
    const transport = createWebRtcTransport({ apiBase: 'https://intervu.cc', fetchImpl: doorbell.fetchImpl, bearer: 'iva_test' });

    const { url, connected } = await transport.start();

    // The link must exist before anyone has opened it — the phone cannot
    // answer a link it has not been sent — and must point at the origin
    // this side dialled, not at whatever the server thinks it is.
    assert.equal(url, 'https://intervu.cc/watch/sess-1');
    assert.ok(doorbell.state.host, 'the offer must be posted by the time start() returns');
    assert.equal(doorbell.state.guest, null, 'nothing may be waited on before the link is handed over');

    // The offer carries its own candidates: no trickle relay exists, so a
    // candidate-free SDP would connect to nothing.
    assert.match(doorbell.state.host!.sdp, /a=candidate/, 'gathering must be complete before signalling');

    const phone = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    const received = new Promise<string>((resolve) => {
      // werift arrives through a dynamic import, so it is untyped here; this
      // is the shape of the two callbacks actually used. Reassembly mirrors
      // the real phone page: concatenate "C" pieces until the "F" piece.
      let assembling = '';
      phone.ondatachannel = (event: { channel: { onmessage: (m: { data: unknown }) => void } }) => {
        event.channel.onmessage = (m: { data: unknown }) => {
          const piece = m.data as string;
          if (piece[0] === 'C') { assembling += piece.slice(1); return; }
          if (piece[0] === 'F') resolve(assembling + piece.slice(1));
        };
      };
    });
    await phone.setRemoteDescription({ type: 'offer', sdp: doorbell.state.host!.sdp });
    await phone.setLocalDescription(await phone.createAnswer());
    doorbell.state.guest = { sdp: phone.localDescription!.sdp };

    await connected;

    // Send ONE frame, BEFORE the channel opens, at the size a real screen
    // produces. This exact combination is what three live failures came
    // down to: no replay-on-open left the phone blank on a static form, and
    // a 142,255-byte frame blew the 65,536-byte message ceiling and took
    // the whole viewer process down. A 4-byte test frame proved nothing.
    const frame = JSON.stringify({ f: 'j'.repeat(142_000), r: null, dw: 1512 });
    transport.sendFrame(frame);
    const payload = await received;
    assert.equal(payload.length, frame.length);
    assert.deepEqual(JSON.parse(payload).dw, 1512);

    await transport.close();
    assert.equal(doorbell.state.deleted, true, 'close() must delete the session, not leave it to its TTL');
    phone.close();
  });
});

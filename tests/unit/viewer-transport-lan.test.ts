import { describe, it, before, after } from 'node:test'; import assert from 'node:assert/strict';
import { createLanTransport, lanUrls } from '../../openclaw/scripts/viewer/transport-lan.mjs';

const IFACES = {
  lo0: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
  en0: [{ family: 'IPv4', internal: false, address: '192.168.1.42' }],
  utun3: [{ family: 'IPv6', internal: false, address: 'fe80::1' }],
};

describe('lanUrls', () => {
  it('builds a URL per external IPv4 address, carrying the token', () => {
    assert.deepEqual(lanUrls(18801, 'tok123', IFACES), ['http://192.168.1.42:18801/?t=tok123']);
  });

  it('returns an empty list when there is no external IPv4', () => {
    assert.deepEqual(lanUrls(18801, 'tok', { lo0: IFACES.lo0 }), []);
  });
});

describe('createLanTransport', () => {
  const transport = createLanTransport({ port: 0, token: 'secret-token' });
  let base = '';
  before(async () => { await transport.start(); base = `http://127.0.0.1:${transport.port()}`; });
  after(async () => { await transport.close(); });

  it('serves the watch page only to a request carrying the right token', async () => {
    assert.equal((await fetch(`${base}/?t=wrong`)).status, 403);
    assert.equal((await fetch(`${base}/`)).status, 403);
    const ok = await fetch(`${base}/?t=secret-token`);
    assert.equal(ok.status, 200);
    assert.match(await ok.text(), /<canvas/);
  });

  it('rejects an unauthorised stream subscriber', async () => {
    const res = await fetch(`${base}/stream?t=wrong`);
    assert.equal(res.status, 403);
    await res.text();
  });

  it('pushes a frame to a subscribed client as an SSE event', async () => {
    const res = await fetch(`${base}/stream?t=secret-token`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/event-stream');
    const reader = res.body!.getReader();
    await reader.read(); // the ": connected" preamble
    transport.sendFrame('QUJD');
    const { value } = await reader.read();
    assert.match(new TextDecoder().decode(value), /data: QUJD/);
    await reader.cancel();
  });
});

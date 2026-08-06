import { describe, it, before, after } from 'node:test'; import assert from 'node:assert/strict';
import { createLanTransport, lanUrls } from '../../openclaw/scripts/viewer/transport-lan.mjs';

const IFACES = {
  lo0: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
  en0: [{ family: 'IPv4', internal: false, address: '192.168.1.42' }],
  utun3: [{ family: 'IPv6', internal: false, address: 'fe80::1' }],
};

describe('lanUrls', () => {
  it('builds a URL per external IPv4 address, carrying the token', () => {
    assert.deepEqual(lanUrls(18801, 'tok123', IFACES), [{ kind: 'lan', url: 'http://192.168.1.42:18801/?t=tok123' }]);
  });

  it('returns an empty list when there is no external IPv4', () => {
    assert.deepEqual(lanUrls(18801, 'tok', { lo0: IFACES.lo0 }), []);
  });

  it('labels an address in the tailnet CGNAT range 100.64.0.0/10 as "tailnet", not "lan"', () => {
    const ifaces = {
      utun100: [{ family: 'IPv4', internal: false, address: '100.111.232.96' }],
      en0: [{ family: 'IPv4', internal: false, address: '192.168.1.42' }],
    };
    assert.deepEqual(lanUrls(18801, 'tok', ifaces), [
      { kind: 'tailnet', url: 'http://100.111.232.96:18801/?t=tok' },
      { kind: 'lan', url: 'http://192.168.1.42:18801/?t=tok' },
    ]);
  });
});

/**
 * Reads until `needle` appears or the budget expires. A plain read() loop
 * blocks forever when the expected data never arrives, which turns a failing
 * assertion into a hung suite — so the deadline is part of the test, not a
 * convenience.
 */
async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, needle: string, ms = 3000) {
  const decoder = new TextDecoder();
  const deadline = Date.now() + ms;
  let seen = '';
  while (Date.now() < deadline && !seen.includes(needle)) {
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), deadline - Date.now()));
    const chunk = await Promise.race([reader.read(), timeout]);
    if (!chunk || chunk.done) break;
    seen += decoder.decode(chunk.value);
  }
  return seen;
}

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

  it('serves every asset the page references using only the page URL', async () => {
    // A browser resolves `./crop.mjs` with no query string, so a module
    // import cannot carry the token. Gating static assets behind it makes the
    // import 403, which kills the whole module script and leaves the page
    // stuck on "connecting" with no error anywhere.
    const html = await (await fetch(`${base}/?t=secret-token`)).text();
    const refs = [...html.matchAll(/(?:from|src)\s*=?\s*['"](\.\/[^'"]+)['"]/g)].map((m) => m[1]);
    assert.ok(refs.length > 0, 'expected the page to reference at least one asset');
    for (const ref of refs) {
      const res = await fetch(new URL(ref, `${base}/`).toString());
      assert.equal(res.status, 200, `${ref} must load without a token`);
      await res.text();
    }
  });

  it('answers the favicon the browser asks for unprompted instead of logging a 403', async () => {
    const res = await fetch(`${base}/favicon.ico`);
    assert.equal(res.status, 204);
    await res.text();
  });

  it('still refuses the screen itself to an unauthorised caller', async () => {
    assert.equal((await fetch(`${base}/?t=wrong`)).status, 403);
    assert.equal((await fetch(`${base}/stream?t=wrong`)).status, 403);
  });

  it('rejects an unauthorised stream subscriber', async () => {
    const res = await fetch(`${base}/stream?t=wrong`);
    assert.equal(res.status, 403);
    await res.text();
  });

  it('replays the current screen to a client that connects after the fact', async () => {
    // SSE has no replay, and Chrome only emits on change — so without this a
    // phone that connects late sits blank until the agent happens to type.
    transport.sendFrame('LATEJOINER');
    const res = await fetch(`${base}/stream?t=secret-token`);
    const reader = res.body!.getReader();
    const seen = await readUntil(reader, 'data: LATEJOINER');
    await reader.cancel();
    assert.match(seen, /data: LATEJOINER/);
  });

  it('starts on a free port when the preferred one is already taken', async () => {
    // Preparing a second application while the first is still open used to
    // die on EADDRINUSE as an unhandled 'error' event: a raw stack trace and
    // no watch link. Nothing depends on the number — it rides in the URL.
    const taken = transport.port()!;
    const second = createLanTransport({ port: taken, token: 'second-token' });
    try {
      await second.start();
      assert.notEqual(second.port(), taken, 'must not claim a port already in use');
      const res = await fetch(`http://127.0.0.1:${second.port()}/?t=second-token`);
      assert.equal(res.status, 200, 'the fallback port must serve the page like any other');
      await res.text();
    } finally {
      await second.close();
    }
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

  it('serves input-capture.mjs without a token, same rationale as crop.mjs', async () => {
    const res = await fetch(`${base}/input-capture.mjs`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /frameTapMessage/);
  });
});

describe('createLanTransport /input', () => {
  it('rejects a POST carrying the wrong token without touching onInput', async () => {
    let called = false;
    const transport = createLanTransport({ port: 0, token: 'tok', onInput: () => { called = true; } });
    await transport.start();
    const base = `http://127.0.0.1:${transport.port()}`;
    const res = await fetch(`${base}/input?t=wrong`, { method: 'POST', body: '{"v":1,"type":"key","key":"Enter"}' });
    assert.equal(res.status, 403);
    await res.text();
    assert.equal(called, false);
    await transport.close();
  });

  it('answers 204 and forwards the raw body to onInput verbatim — parsing is the sink\'s job', async () => {
    const seen: string[] = [];
    const transport = createLanTransport({ port: 0, token: 'tok', onInput: (text: string) => seen.push(text) });
    await transport.start();
    const base = `http://127.0.0.1:${transport.port()}`;
    const body = '{"v":1,"type":"key","key":"Enter"}';
    const res = await fetch(`${base}/input?t=tok`, { method: 'POST', body });
    assert.equal(res.status, 204);
    await res.text();
    assert.deepEqual(seen, [body]);
    await transport.close();
  });
});

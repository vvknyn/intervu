import { describe, it } from 'node:test'; import assert from 'node:assert/strict';
import { listPageTargets, pickActiveTarget } from '../../openclaw/scripts/viewer/cdp-targets.mjs';
import { createFramePump } from '../../openclaw/scripts/viewer/frame-pump.mjs';

/** Exactly what the pump writes to `send` — see the JSDoc on createFramePump. */
type CdpCommand = { id: number; method: string; params: Record<string, unknown> };

const TARGETS = [
  { id: 'a', type: 'page', title: 'Ashby — Apply', url: 'https://jobs.ashbyhq.com/x', webSocketDebuggerUrl: 'ws://127.0.0.1:18800/devtools/page/a' },
  { id: 'b', type: 'page', title: 'Resume', url: 'http://localhost:9000/resume.html', webSocketDebuggerUrl: 'ws://127.0.0.1:18800/devtools/page/b' },
  { id: 'c', type: 'service_worker', title: 'sw', url: 'https://x/sw.js', webSocketDebuggerUrl: 'ws://127.0.0.1:18800/devtools/worker/c' },
  { id: 'd', type: 'page', title: 'No debugger', url: 'https://y', webSocketDebuggerUrl: '' },
];

describe('cdp-targets', () => {
  it('keeps only page targets that expose a debugger socket', async () => {
    const fake = async () => ({ ok: true, status: 200, json: async () => TARGETS });
    const out = await listPageTargets('http://127.0.0.1:18800', fake as unknown as typeof fetch);
    assert.deepEqual(out.map((t: { id: string }) => t.id), ['a', 'b']);
  });

  it('throws a message naming the port when CDP is unreachable', async () => {
    const fake = async () => { throw new Error('ECONNREFUSED'); };
    await assert.rejects(
      () => listPageTargets('http://127.0.0.1:18800', fake as unknown as typeof fetch),
      (e: Error) => e.message.includes('18800'),
    );
  });

  it('throws naming the status when CDP answers non-200', async () => {
    const fake = async () => ({ ok: false, status: 503, json: async () => ({}) });
    await assert.rejects(
      () => listPageTargets('http://127.0.0.1:18800', fake as unknown as typeof fetch),
      (e: Error) => e.message.includes('503'),
    );
  });

  it('picks the first page target (CDP lists most-recently-active first)', () => {
    assert.equal(pickActiveTarget(TARGETS.slice(0, 2))?.id, 'a');
    assert.equal(pickActiveTarget([]), null);
  });
});

describe('frame-pump', () => {
  it('enables the page and starts a screencast on start()', () => {
    const sent: CdpCommand[] = [];
    const pump = createFramePump({ send: (m: CdpCommand) => sent.push(m), onFrame: () => {} });
    pump.start();
    const methods = sent.map((m) => m.method);
    assert.ok(methods.includes('Page.enable'));
    assert.ok(methods.includes('Page.startScreencast'));
    const cast = sent.find((m) => m.method === 'Page.startScreencast');
    assert.ok(cast);
    assert.equal(cast.params.format, 'jpeg');
  });

  it('emits each frame and acknowledges it so Chrome sends the next', () => {
    const sent: CdpCommand[] = [];
    const frames: string[] = [];
    const pump = createFramePump({
      send: (m: CdpCommand) => sent.push(m),
      onFrame: (f: { data: string }) => frames.push(f.data),
    });
    pump.start();
    pump.handle({ method: 'Page.screencastFrame', params: { data: 'AAAA', sessionId: 7, metadata: {} } });
    assert.deepEqual(frames, ['AAAA']);
    const ack = sent.find((m) => m.method === 'Page.screencastFrameAck');
    assert.ok(ack);
    assert.equal(ack.params.sessionId, 7);
  });

  it('ignores unrelated CDP messages without emitting or acking', () => {
    const sent: CdpCommand[] = [];
    const frames: string[] = [];
    const pump = createFramePump({
      send: (m: CdpCommand) => sent.push(m),
      onFrame: (f: { data: string }) => frames.push(f.data),
    });
    pump.start();
    const before = sent.length;
    pump.handle({ method: 'Network.requestWillBeSent', params: {} });
    pump.handle({ id: 1, result: {} });
    assert.equal(frames.length, 0);
    assert.equal(sent.length, before);
  });

  it('captures an initial frame, so a page that never changes is not blank', () => {
    // Page.startScreencast emits only on pixel change. Without an explicit
    // first capture, a finished form produces zero frames and the phone
    // shows nothing at all. Verified live: 0 frames in 5s while static.
    const sent: CdpCommand[] = [];
    const frames: string[] = [];
    const pump = createFramePump({
      send: (m: CdpCommand) => sent.push(m),
      onFrame: (f: { data: string }) => frames.push(f.data),
    });
    pump.start();
    const shot = sent.find((m) => m.method === 'Page.captureScreenshot') as { id: number } | undefined;
    assert.ok(shot, 'start() must request an initial screenshot');
    pump.handle({ id: shot!.id, result: { data: 'INITIAL' } });
    assert.deepEqual(frames, ['INITIAL']);
  });

  it('does not mistake an unrelated command response for a frame', () => {
    const sent: CdpCommand[] = [];
    const frames: string[] = [];
    const pump = createFramePump({
      send: (m: CdpCommand) => sent.push(m),
      onFrame: (f: { data: string }) => frames.push(f.data),
    });
    pump.start();
    const shot = sent.find((m) => m.method === 'Page.captureScreenshot') as { id: number };
    pump.handle({ id: shot.id + 999, result: { data: 'NOT-A-FRAME' } });
    assert.deepEqual(frames, []);
  });

  it('asks the page for the focused field so the phone can crop to it', () => {
    const sent: CdpCommand[] = [];
    const seen: unknown[] = [];
    const pump = createFramePump({
      send: (m: CdpCommand) => sent.push(m),
      onFrame: () => {},
      onFocus: (f: unknown) => seen.push(f),
    });
    pump.start();
    pump.pollFocus();
    const evalCmd = sent.find((m) => m.method === 'Runtime.evaluate');
    assert.ok(evalCmd, 'pollFocus() must issue a Runtime.evaluate');
    assert.match(String(evalCmd.params.expression), /activeElement/);

    pump.handle({ id: evalCmd.id, result: { result: { value: JSON.stringify({ dw: 1512, r: { x: 10, y: 20, width: 300, height: 40 } }) } } });
    assert.deepEqual(seen, [{ dw: 1512, r: { x: 10, y: 20, width: 300, height: 40 } }]);
  });

  it('reports no focus rather than guessing when the page returns nothing usable', () => {
    const sent: CdpCommand[] = [];
    const seen: unknown[] = [];
    const pump = createFramePump({
      send: (m: CdpCommand) => sent.push(m),
      onFrame: () => {},
      onFocus: (f: unknown) => seen.push(f),
    });
    pump.start();
    pump.pollFocus();
    const evalCmd = sent.find((m) => m.method === 'Runtime.evaluate') as { id: number };
    pump.handle({ id: evalCmd.id, result: { result: { value: 'not json' } } });
    assert.deepEqual(seen, [null]);
  });

  it('uses a unique id for every outbound command', () => {
    const sent: CdpCommand[] = [];
    const pump = createFramePump({ send: (m: CdpCommand) => sent.push(m), onFrame: () => {} });
    pump.start();
    pump.handle({ method: 'Page.screencastFrame', params: { data: 'B', sessionId: 1, metadata: {} } });
    const ids = sent.map((m) => m.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});

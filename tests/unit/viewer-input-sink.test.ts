import { describe, it } from 'node:test'; import assert from 'node:assert/strict';
import { createInputSink } from '../../openclaw/scripts/viewer/input-sink.mjs';
import { createFramePump } from '../../openclaw/scripts/viewer/frame-pump.mjs';
import { createIdAllocator } from '../../openclaw/scripts/viewer/cdp-id.mjs';

/** Records every CDP command the sink issues, in order. */
function recordingSink({ deviceWidth = () => 1512, deviceHeight = () => 800 }: { deviceWidth?: () => number | null; deviceHeight?: () => number | null } = {}) {
  const sent: Array<{ id: number; method: string; params: Record<string, unknown> }> = [];
  const logs: string[] = [];
  const sink = createInputSink({ send: (m: any) => sent.push(m), deviceWidth, deviceHeight, log: (line: string) => logs.push(line) });
  return { sink, sent, logs };
}

const on = () => JSON.stringify({ v: 1, type: 'control', on: true });
const off = () => JSON.stringify({ v: 1, type: 'control', on: false });
const tap = (over = {}) => JSON.stringify({ v: 1, type: 'tap', fx: 200, fy: 80, fw: 1000, fh: 600, ...over });
const scroll = (over = {}) => JSON.stringify({ v: 1, type: 'scroll', fdy: 40, fw: 1000, ...over });

describe('createInputSink', () => {
  it('drops a tap that arrives before control is taken', () => {
    const { sink, sent } = recordingSink();
    sink.handle(tap());
    assert.deepEqual(sent, []);
  });

  it('dispatches a mouse click at the scaled device coordinates once control is on', () => {
    const { sink, sent } = recordingSink({ deviceWidth: () => 1512 });
    sink.handle(on());
    sink.handle(tap());
    const x = Math.round((200 * 1512) / 1000);
    const y = Math.round((80 * 1512) / 1000);
    assert.equal(sent.length, 2);
    assert.deepEqual(sent[0].method, 'Input.dispatchMouseEvent');
    assert.deepEqual(sent[0].params, { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    assert.deepEqual(sent[1].params, { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  });

  it('re-arms the gate on control:false, dropping input again', () => {
    const { sink, sent } = recordingSink();
    sink.handle(on());
    sink.handle(off());
    sink.handle(tap());
    assert.deepEqual(sent, []);
  });

  it('emits Input.insertText for a text message', () => {
    const { sink, sent } = recordingSink();
    sink.handle(on());
    sink.handle(JSON.stringify({ v: 1, type: 'text', insert: 'hello' }));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].method, 'Input.insertText');
    assert.deepEqual(sent[0].params, { text: 'hello' });
  });

  it('emits keyDown with text:"\\r" for Enter (native submit/newline needs the text), and plain rawKeyDown for Tab', () => {
    const { sink, sent } = recordingSink();
    sink.handle(on());
    sink.handle(JSON.stringify({ v: 1, type: 'key', key: 'Enter' }));
    assert.equal(sent.length, 2);
    assert.deepEqual(sent[0].params, { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
    assert.deepEqual(sent[1].params, { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  });

  it('leaves Tab as textless rawKeyDown — the OTHER key in the table, unaffected by the Enter fix', () => {
    const { sink, sent } = recordingSink();
    sink.handle(on());
    sink.handle(JSON.stringify({ v: 1, type: 'key', key: 'Tab' }));
    assert.equal(sent.length, 2);
    assert.deepEqual(sent[0].params, { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    assert.deepEqual(sent[1].params, { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  });

  it('never throws and drops silently on malformed input, wrong version, or unknown type', () => {
    const { sink, sent } = recordingSink();
    sink.handle(on());
    assert.doesNotThrow(() => sink.handle('{not json'));
    assert.doesNotThrow(() => sink.handle(JSON.stringify({ v: 2, type: 'tap', fx: 1, fy: 1, fw: 10, fh: 10 })));
    assert.doesNotThrow(() => sink.handle(JSON.stringify({ v: 1, type: 'wobble', dy: 5 })));
    assert.deepEqual(sent, []);
  });

  it('drops text over 2000 chars and taps with non-finite numbers', () => {
    const { sink, sent } = recordingSink();
    sink.handle(on());
    sink.handle(JSON.stringify({ v: 1, type: 'text', insert: 'x'.repeat(2001) }));
    sink.handle(tap({ fx: Number.POSITIVE_INFINITY }));
    sink.handle(tap({ fy: NaN }));
    assert.deepEqual(sent, []);
  });

  it('drops a tap when deviceWidth() is null, but text still flows', () => {
    const { sink, sent } = recordingSink({ deviceWidth: () => null });
    sink.handle(on());
    sink.handle(tap());
    assert.equal(sent.length, 0, 'no scale exists, so a tap cannot be mapped');
    sink.handle(JSON.stringify({ v: 1, type: 'text', insert: 'hi' }));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].method, 'Input.insertText');
  });

  describe('scroll', () => {
    it('dispatches mouseWheel at the viewport center with deltaY scaled the same way a tap scales', () => {
      const { sink, sent } = recordingSink({ deviceWidth: () => 1512, deviceHeight: () => 800 });
      sink.handle(on());
      sink.handle(scroll());
      const deltaY = Math.round((40 * 1512) / 1000);
      assert.equal(sent.length, 1);
      assert.equal(sent[0].method, 'Input.dispatchMouseEvent');
      assert.deepEqual(sent[0].params, { type: 'mouseWheel', x: 756, y: 400, deltaX: 0, deltaY });
    });

    it('drops a scroll that arrives before control is taken — same gate as every other input', () => {
      const { sink, sent } = recordingSink();
      sink.handle(scroll());
      assert.deepEqual(sent, []);
    });

    it('drops a scroll with a malformed shape (missing fdy/fw)', () => {
      const { sink, sent } = recordingSink();
      sink.handle(on());
      sink.handle(JSON.stringify({ v: 1, type: 'scroll', dy: 5 }));
      assert.deepEqual(sent, []);
    });

    it('drops a scroll when deviceHeight() is null — no center to dispatch at, so nothing is fabricated', () => {
      const { sink, sent } = recordingSink({ deviceHeight: () => null });
      sink.handle(on());
      sink.handle(scroll());
      assert.deepEqual(sent, [], 'deviceWidth alone is not enough — the y center is unknown too');
    });
  });

  describe('Backspace key', () => {
    it('emits textless rawKeyDown+keyUp for Backspace — the third row in the same table as Enter/Tab', () => {
      const { sink, sent } = recordingSink();
      sink.handle(on());
      sink.handle(JSON.stringify({ v: 1, type: 'key', key: 'Backspace' }));
      assert.equal(sent.length, 2);
      assert.deepEqual(sent[0].params, { type: 'rawKeyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
      assert.deepEqual(sent[1].params, { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    });
  });

  describe('control transitions are logged', () => {
    it('logs CONTROL ON/OFF with the source that sent the message', () => {
      const { sink, logs } = recordingSink();
      sink.handle(on(), 'lan');
      sink.handle(off(), 'webrtc');
      assert.deepEqual(logs, ['CONTROL ON (lan)', 'CONTROL OFF (webrtc)']);
    });

    it('reset() re-arms the gate and logs CONTROL RESET, distinct from an explicit control:false', () => {
      const { sink, sent, logs } = recordingSink();
      sink.handle(on(), 'lan');
      sink.reset();
      sink.handle(tap());
      assert.deepEqual(sent, [], 'control must be off again after reset()');
      assert.deepEqual(logs, ['CONTROL ON (lan)', 'CONTROL RESET (disconnect)']);
    });

    it('reset() is a silent no-op when control was already off — no log spam on an ordinary disconnect', () => {
      const { sink, logs } = recordingSink();
      sink.reset();
      sink.reset();
      assert.deepEqual(logs, []);
    });
  });

  describe('CDP id allocator', () => {
    it('defaults to its own private counter starting at 1', () => {
      const { sink, sent } = recordingSink();
      sink.handle(on());
      sink.handle(tap());
      assert.deepEqual(sent.map((m) => m.id), [1, 2]);
    });

    it('shares one injected allocator with another CDP writer, so ids never collide across the two', () => {
      // The real bug this guards: input-sink.mjs and frame-pump.mjs each ran
      // their own counter from 1 on the SAME socket, so a sink command and a
      // pump command could mint the same id — frame-pump.mjs then consumed
      // the sink's ack as its own focus reply (onFocus(null)).
      const nextId = createIdAllocator();
      const sinkSent: Array<{ id: number }> = [];
      const pumpSent: Array<{ id: number }> = [];
      const sink = createInputSink({ send: (m: any) => sinkSent.push(m), deviceWidth: () => 1512, nextId });
      const pump = createFramePump({ send: (m: any) => pumpSent.push(m), onFrame: () => {}, nextId });

      sink.handle(on());
      pump.start();
      sink.handle(tap());
      pump.pollFocus();

      const allIds = [...sinkSent, ...pumpSent].map((m) => m.id);
      assert.equal(new Set(allIds).size, allIds.length, `ids collided: ${allIds.join(',')}`);
    });
  });
});

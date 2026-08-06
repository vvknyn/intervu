import { describe, it } from 'node:test'; import assert from 'node:assert/strict';
import { createInputSink } from '../../openclaw/scripts/viewer/input-sink.mjs';

/** Records every CDP command the sink issues, in order. */
function recordingSink({ deviceWidth = () => 1512 } = {}) {
  const sent: Array<{ id: number; method: string; params: Record<string, unknown> }> = [];
  const sink = createInputSink({ send: (m: any) => sent.push(m), deviceWidth });
  return { sink, sent };
}

const on = () => JSON.stringify({ v: 1, type: 'control', on: true });
const off = () => JSON.stringify({ v: 1, type: 'control', on: false });
const tap = (over = {}) => JSON.stringify({ v: 1, type: 'tap', fx: 200, fy: 80, fw: 1000, fh: 600, ...over });

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

  it('emits rawKeyDown then keyUp for Enter and Tab', () => {
    const { sink, sent } = recordingSink();
    sink.handle(on());
    sink.handle(JSON.stringify({ v: 1, type: 'key', key: 'Enter' }));
    sink.handle(JSON.stringify({ v: 1, type: 'key', key: 'Tab' }));
    assert.equal(sent.length, 4);
    assert.deepEqual(sent[0].params, { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    assert.deepEqual(sent[1].params, { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    assert.deepEqual(sent[2].params, { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    assert.deepEqual(sent[3].params, { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  });

  it('never throws and drops silently on malformed input, wrong version, or unknown type', () => {
    const { sink, sent } = recordingSink();
    sink.handle(on());
    assert.doesNotThrow(() => sink.handle('{not json'));
    assert.doesNotThrow(() => sink.handle(JSON.stringify({ v: 2, type: 'tap', fx: 1, fy: 1, fw: 10, fh: 10 })));
    assert.doesNotThrow(() => sink.handle(JSON.stringify({ v: 1, type: 'scroll', dy: 5 })));
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
    assert.deepEqual(sent, [], 'no scale exists, so a tap cannot be mapped');
    sink.handle(JSON.stringify({ v: 1, type: 'text', insert: 'hi' }));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].method, 'Input.insertText');
  });
});

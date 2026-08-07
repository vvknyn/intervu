import { describe, it } from 'node:test'; import assert from 'node:assert/strict';
import {
  frameTapMessage, frameScrollMessage, textMessage, keyMessage, controlMessage,
  isSwipe, classifyTyperInput, TYPER_SENTINEL,
} from '../../openclaw/scripts/viewer/input-capture.mjs';

describe('frameTapMessage', () => {
  it('maps an uncropped tap through css→frame scaling', () => {
    // canvas is the whole 1000px-wide frame rendered at 500 css px
    const m = frameTapMessage({ cssX: 100, cssY: 40, cssWidth: 500, crop: null, imageWidth: 1000, imageHeight: 600 });
    assert.deepEqual(m, { v: 1, type: 'tap', fx: 200, fy: 80, fw: 1000, fh: 600 });
  });

  it('offsets by the crop origin when cropped', () => {
    const crop = { sx: 300, sy: 120, sw: 400, sh: 300 };
    // canvas shows the 400px-wide crop at 200 css px → scale 2
    const m = frameTapMessage({ cssX: 50, cssY: 30, cssWidth: 200, crop, imageWidth: 1000, imageHeight: 600 });
    assert.deepEqual(m, { v: 1, type: 'tap', fx: 400, fy: 180, fw: 1000, fh: 600 });
  });

  it('returns null for a tap outside the frame', () => {
    assert.equal(frameTapMessage({ cssX: 9999, cssY: 0, cssWidth: 500, crop: null, imageWidth: 1000, imageHeight: 600 }), null);
  });

  it('builds a text message', () => {
    assert.deepEqual(textMessage('hi'), { v: 1, type: 'text', insert: 'hi' });
  });
});

describe('keyMessage / controlMessage', () => {
  // Trivial builders, but every producer (LAN page, WebRTC watch-canvas)
  // must emit an identical shape — one test each pins the contract.
  it('builds a key message', () => {
    assert.deepEqual(keyMessage('Enter'), { v: 1, type: 'key', key: 'Enter' });
  });

  it('builds a control message', () => {
    assert.deepEqual(controlMessage(true), { v: 1, type: 'control', on: true });
  });
});

describe('frameScrollMessage', () => {
  it('scales an uncropped swipe by the same rule an uncropped tap uses', () => {
    // Same setup as frameTapMessage's first test: 1000px-wide frame at 500 css px -> 2x scale.
    const scroll = frameScrollMessage({ cssDy: 40, cssWidth: 500, crop: null, imageWidth: 1000, imageHeight: 600 });
    assert.deepEqual(scroll, { v: 1, type: 'scroll', fdy: 80, fw: 1000 });
    const tap = frameTapMessage({ cssX: 0, cssY: 40, cssWidth: 500, crop: null, imageWidth: 1000, imageHeight: 600 });
    assert.equal(tap!.fy, 80, 'a tap at the same css delta lands at the same frame delta as the swipe');
  });

  it('scales a cropped swipe by the crop width, matching a cropped tap — the OTHER case, not the uncropped one above', () => {
    const crop = { sx: 300, sy: 120, sw: 400, sh: 300 };
    // canvas shows the 400px-wide crop at 200 css px -> scale 2, same as frameTapMessage's cropped test.
    const scroll = frameScrollMessage({ cssDy: 30, cssWidth: 200, crop, imageWidth: 1000, imageHeight: 600 });
    assert.deepEqual(scroll, { v: 1, type: 'scroll', fdy: 60, fw: 1000 });
  });
});

describe('isSwipe', () => {
  it('treats small jitter under the threshold as a tap, not a swipe', () => {
    assert.equal(isSwipe(2, 3), false);
  });

  it('treats a real vertical drag past the threshold as a swipe', () => {
    assert.equal(isSwipe(1, 40), true);
  });

  it('is direction-agnostic — diagonal movement past the threshold is still a swipe', () => {
    assert.equal(isSwipe(20, 20), true);
  });
});

describe('classifyTyperInput', () => {
  it('treats an insert inputType as text and resets the field to the sentinel', () => {
    const r = classifyTyperInput('insertText', TYPER_SENTINEL + 'h');
    assert.deepEqual(r.messages, [textMessage('h')]);
    assert.equal(r.reset, TYPER_SENTINEL);
  });

  it('sends nothing when the field still reads back as exactly the sentinel', () => {
    const r = classifyTyperInput('insertText', TYPER_SENTINEL);
    assert.deepEqual(r.messages, []);
  });

  it('sends one Backspace for deleteContentBackward eating the sentinel down to empty', () => {
    const r = classifyTyperInput('deleteContentBackward', '');
    assert.deepEqual(r.messages, [keyMessage('Backspace')]);
    assert.equal(r.reset, TYPER_SENTINEL);
  });

  it('handles the word-delete variant the same way — the OTHER delete inputType, not the one that motivated the fix', () => {
    const r = classifyTyperInput('deleteWordBackward', '');
    assert.deepEqual(r.messages, [keyMessage('Backspace')]);
  });

  it('survives a full type-then-delete-everything cycle, always landing back on the sentinel', () => {
    let value = TYPER_SENTINEL;
    const sent: unknown[] = [];
    for (const ch of ['h', 'i']) {
      const r = classifyTyperInput('insertText', TYPER_SENTINEL + ch);
      sent.push(...r.messages);
      value = r.reset;
    }
    for (let i = 0; i < 2; i++) {
      const r = classifyTyperInput('deleteContentBackward', '');
      sent.push(...r.messages);
      value = r.reset;
    }
    assert.deepEqual(sent, [textMessage('h'), textMessage('i'), keyMessage('Backspace'), keyMessage('Backspace')]);
    assert.equal(value, TYPER_SENTINEL, 'field is back at the sentinel baseline, ready for the next keystroke');
  });
});

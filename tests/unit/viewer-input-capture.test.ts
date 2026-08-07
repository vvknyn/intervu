import { describe, it } from 'node:test'; import assert from 'node:assert/strict';
import { frameTapMessage, textMessage, keyMessage, controlMessage } from '../../openclaw/scripts/viewer/input-capture.mjs';

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

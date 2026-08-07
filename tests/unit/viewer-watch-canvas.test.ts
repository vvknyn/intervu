import { describe, it } from 'node:test'; import assert from 'node:assert/strict';
import { ENDED_COPY, isNewOffer, tapAction, trySend } from '../../src/lib/viewer/watch-input';

/**
 * Covers the pure decisions behind watch-canvas.tsx's tap+type control
 * (D8/D11). The component itself imports RTCPeerConnection, canvas refs,
 * and openclaw's input-capture.mjs (a parallel-track file), none of which
 * this repo can exercise directly — no @testing-library / jsdom / vitest
 * dependency (see tests/unit/jobs-upload-continuation.test.ts for the same
 * constraint on a different page). These tests instead prove the decisions
 * that drive that wiring, imported from src/lib/viewer/watch-input.ts.
 */

describe('ENDED_COPY', () => {
  it('is the honest dead-link message, not the old "this session has ended"', () => {
    assert.equal(ENDED_COPY, 'This session has ended. The newest message in your chat has the current link.');
  });
});

describe('tapAction', () => {
  const message = { v: 1 as const, type: 'tap' as const, fx: 200, fy: 80, fw: 1000, fh: 600 };

  it('toggles zoom and sends nothing when control is off, regardless of any computed message', () => {
    assert.deepEqual(tapAction(false, message), { kind: 'zoom' });
    assert.deepEqual(tapAction(false, null), { kind: 'zoom' });
  });

  it('sends the tap message verbatim when control is on', () => {
    assert.deepEqual(tapAction(true, message), { kind: 'send', message });
  });

  it('does nothing when control is on but the tap landed outside the frame', () => {
    assert.equal(tapAction(true, null), null);
  });
});

describe('isNewOffer', () => {
  it('accepts any offer on the initial join (no previous answer yet)', () => {
    assert.equal(isNewOffer('v=0 offer-1', null), true);
  });

  it('rejects re-answering the same offer it already answered', () => {
    assert.equal(isNewOffer('v=0 offer-1', 'v=0 offer-1'), false);
  });

  it('accepts a genuinely new offer after a reconnect', () => {
    assert.equal(isNewOffer('v=0 offer-2', 'v=0 offer-1'), true);
  });

  it('treats no offer yet as not new', () => {
    assert.equal(isNewOffer(undefined, 'v=0 offer-1'), false);
    assert.equal(isNewOffer(null, null), false);
  });
});

describe('trySend', () => {
  it('sends the JSON-stringified payload and reports success on an open channel', () => {
    const sent: string[] = [];
    const channel = { send: (data: string) => sent.push(data) };
    const ok = trySend(channel, { v: 1, type: 'control', on: true });
    assert.equal(ok, true);
    assert.deepEqual(sent, [JSON.stringify({ v: 1, type: 'control', on: true })]);
  });

  it('catches a throw from send() (a closed/not-yet-open channel) and reports failure instead of throwing', () => {
    const channel = { send: () => { throw new DOMException('failed to execute send', 'InvalidStateError'); } };
    assert.doesNotThrow(() => {
      const ok = trySend(channel, { v: 1, type: 'text', insert: 'hi' });
      assert.equal(ok, false);
    });
  });

  it('reports failure for a null/undefined channel — the OTHER failure mode besides a throwing send()', () => {
    assert.equal(trySend(null, { v: 1, type: 'key', key: 'Enter' }), false);
    assert.equal(trySend(undefined, { v: 1, type: 'key', key: 'Enter' }), false);
  });
});

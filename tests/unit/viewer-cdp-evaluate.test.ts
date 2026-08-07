import { describe, it } from 'node:test'; import assert from 'node:assert/strict';
import { cdpEvaluate } from '../../openclaw/scripts/viewer.mjs';
import { createIdAllocator } from '../../openclaw/scripts/viewer/cdp-id.mjs';

/**
 * A minimal stand-in for the browser WebSocket viewer.mjs drives: records
 * what was sent and lets the test push a canned response through the same
 * addEventListener('message', ...) API cdpEvaluate itself uses.
 */
function fakeSocket() {
  const listeners = new Set<(event: { data: string }) => void>();
  const sent: string[] = [];
  return {
    addEventListener: (_type: string, fn: (event: { data: string }) => void) => listeners.add(fn),
    removeEventListener: (_type: string, fn: (event: { data: string }) => void) => listeners.delete(fn),
    send: (data: string) => sent.push(data),
    emit(message: unknown) { for (const fn of [...listeners]) fn({ data: JSON.stringify(message) }); },
    sent,
  };
}

describe('cdpEvaluate', () => {
  it('resolves with the evaluated value on a clean Runtime.evaluate response', async () => {
    const socket = fakeSocket();
    const promise = cdpEvaluate(socket, '1+1', createIdAllocator());
    const { id } = JSON.parse(socket.sent[0]);
    socket.emit({ id, result: { result: { value: 2 } } });
    assert.equal(await promise, 2);
  });

  it('rejects on a page-side exception (exceptionDetails)', async () => {
    const socket = fakeSocket();
    const promise = cdpEvaluate(socket, 'throw new Error("x")', createIdAllocator());
    const { id } = JSON.parse(socket.sent[0]);
    socket.emit({ id, result: { exceptionDetails: { text: 'boom' } } });
    await assert.rejects(() => promise, /boom/);
  });

  it('rejects on a protocol-level error instead of silently resolving undefined', async () => {
    // The real bug this guards: a CDP {id, error:{...}} response has no
    // `.result` at all, so the old code's `message.result?.result?.value`
    // resolved to `undefined` and the audit printed "AUDIT: undefined"
    // instead of a real, diagnosable failure.
    const socket = fakeSocket();
    const promise = cdpEvaluate(socket, 'bogus', createIdAllocator());
    const { id } = JSON.parse(socket.sent[0]);
    socket.emit({ id, error: { code: -32601, message: "'Bogus.method' wasn't found" } });
    await assert.rejects(() => promise, /wasn't found/);
  });

  it('times out instead of hanging forever when no response ever arrives', async () => {
    const socket = fakeSocket();
    await assert.rejects(() => cdpEvaluate(socket, '1+1', createIdAllocator(), 20), /timed out/);
  });

  it('ignores a message addressed to a different id, then resolves once the right one arrives', async () => {
    const socket = fakeSocket();
    const promise = cdpEvaluate(socket, '1+1', createIdAllocator(), 500);
    const { id } = JSON.parse(socket.sent[0]);
    socket.emit({ id: id + 999, result: { result: { value: 'wrong' } } });
    socket.emit({ id, result: { result: { value: 'right' } } });
    assert.equal(await promise, 'right');
  });

  it('uses the injected id allocator rather than a fixed id, so it never collides with a sibling CDP writer', async () => {
    const nextId = createIdAllocator();
    nextId(); // simulate another writer (input-sink/frame-pump) having already taken id 1
    const socket = fakeSocket();
    const promise = cdpEvaluate(socket, '1+1', nextId);
    const { id } = JSON.parse(socket.sent[0]);
    assert.equal(id, 2, 'must continue the shared sequence, not restart from a fixed id');
    socket.emit({ id, result: { result: { value: 'ok' } } });
    assert.equal(await promise, 'ok');
  });
});

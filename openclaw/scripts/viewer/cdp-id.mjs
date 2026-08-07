/**
 * One counter for every CDP command id issued on a shared WebSocket.
 *
 * input-sink.mjs, frame-pump.mjs, and viewer.mjs's own cdpEvaluate all write
 * commands onto the SAME CDP socket. Each keeping its own counter let two
 * modules independently mint the same id, so a response could be delivered
 * to the wrong caller — frame-pump.mjs mistaking an input-sink ack for its
 * own focus reply (onFocus(null)) was the live failure. One shared
 * allocator, injected everywhere a command touches this socket, makes that
 * collision impossible by construction rather than by picking
 * non-overlapping ranges (offset magic), which just moves the same bug to
 * whichever caller forgets to update its range.
 *
 * Defaults to a private counter when no `nextId` is injected, so every
 * existing standalone caller (most unit tests) keeps counting from 1 on its
 * own — sharing only happens where a caller explicitly passes one allocator
 * into two consumers.
 */
export function createIdAllocator(start = 1) {
    let next = start;
    return () => next++;
}

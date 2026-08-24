import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createPostAuthHandoff } from "../../src/lib/auth/post-auth-redirect";

/** A promise plus the handles to settle it later, so a test can hold the
 *  session sync open and inspect what happened while it was still in flight. */
function deferred<T = void>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe("post-auth handoff", () => {
    it("does not leave until the server session is established", async () => {
        // The reported bug: Firebase's auth-state signal resolves a round trip
        // before /api/auth/session has minted the cookie, so leaving on the
        // signal alone lands on a server render that still says "signed out".
        const session = deferred();
        const visited: string[] = [];
        const handOff = createPostAuthHandoff({
            ensureServerSession: () => session.promise,
            leave: (destination) => visited.push(destination),
        });

        const done = handOff("/oauth/authorize?client_id=abc");
        await Promise.resolve();
        assert.deepEqual(visited, [], "left before the server session existed");

        session.resolve();
        await done;
        assert.deepEqual(visited, ["/oauth/authorize?client_id=abc"]);
    });

    it("still leaves — and reports — when the session sync fails", async () => {
        // A different case from the one that surfaced the bug: refusing to
        // navigate would strand someone on the sign-in page with no feedback,
        // while any cookie an earlier sync minted is still perfectly good.
        const failure = new Error("session endpoint down");
        const visited: string[] = [];
        const reported: unknown[] = [];

        await createPostAuthHandoff({
            ensureServerSession: () => Promise.reject(failure),
            leave: (destination) => visited.push(destination),
            reportError: (error) => reported.push(error),
        })("/jobs");

        assert.deepEqual(visited, ["/jobs"]);
        assert.deepEqual(reported, [failure], "swallowed a failed session sync");
    });

    it("leaves once when several watchers see the same sign-in", async () => {
        // Also a different case: the sign-in page has two independent success
        // watchers (an auth-state effect and the form's own callback) and both
        // fire. Only one navigation should result, and the session should be
        // synced once rather than once per watcher.
        let syncs = 0;
        const visited: string[] = [];
        const handOff = createPostAuthHandoff({
            ensureServerSession: async () => {
                syncs += 1;
            },
            leave: (destination) => visited.push(destination),
        });

        await Promise.all([handOff("/jobs"), handOff("/yours"), handOff("/jobs")]);

        assert.equal(syncs, 1, "synced the session once per watcher");
        assert.deepEqual(visited, ["/jobs"], "navigated more than once");
    });
});

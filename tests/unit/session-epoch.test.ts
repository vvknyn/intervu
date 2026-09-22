import { test } from "node:test";
import assert from "node:assert/strict";
import {
    isCurrentSessionEpoch,
    reduceSessionEpoch,
} from "../../src/lib/auth/session-epoch";

test("isCurrentSessionEpoch accepts the current epoch", () => {
    assert.equal(isCurrentSessionEpoch(2, 2), true);
});

test("isCurrentSessionEpoch rejects stale epochs", () => {
    assert.equal(isCurrentSessionEpoch(1, 2), false);
    assert.equal(isCurrentSessionEpoch(3, 2), false);
});

test("after sign-out, a stale deep-link user result is ignored", () => {
    let state = { epoch: 0, user: { uid: "u1" } as unknown };

    state = reduceSessionEpoch(state, { type: "sign-out" });
    assert.equal(state.epoch, 1);
    assert.equal(state.user, null);

    state = reduceSessionEpoch(state, {
        type: "resolved",
        requestEpoch: 0,
        user: { uid: "u1" },
    });
    assert.equal(state.user, null);
});

test("after sign-out, a current-epoch null keeps the session signed out", () => {
    let state = { epoch: 0, user: { uid: "u1" } as unknown };

    state = reduceSessionEpoch(state, { type: "sign-out" });
    state = reduceSessionEpoch(state, {
        type: "resolved",
        requestEpoch: 1,
        user: null,
    });

    assert.equal(state.epoch, 1);
    assert.equal(state.user, null);
});

test("current-epoch user result applies after the initial fetch", () => {
    const state = reduceSessionEpoch(
        { epoch: 0, user: null },
        { type: "resolved", requestEpoch: 0, user: { uid: "u1" } },
    );

    assert.deepEqual(state, { epoch: 0, user: { uid: "u1" } });
});

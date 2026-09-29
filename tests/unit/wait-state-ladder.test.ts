import test from "node:test";
import assert from "node:assert/strict";
import {
    WAIT_PATIENCE_AFTER_MS,
    WAIT_SKELETON_AFTER_MS,
    WAIT_STATUS_AFTER_MS,
    waitStageAt,
    waitViewFor,
} from "@/lib/wait-state/ladder";

test("waitStageAt: quiet < 300 ms, skeleton to 2 s, status to 8 s, then patience", () => {
    assert.equal(waitStageAt(0), "quiet");
    assert.equal(waitStageAt(WAIT_SKELETON_AFTER_MS - 1), "quiet");
    assert.equal(waitStageAt(WAIT_SKELETON_AFTER_MS), "skeleton");
    assert.equal(waitStageAt(WAIT_STATUS_AFTER_MS - 1), "skeleton");
    assert.equal(waitStageAt(WAIT_STATUS_AFTER_MS), "status");
    assert.equal(waitStageAt(WAIT_PATIENCE_AFTER_MS - 1), "status");
    assert.equal(waitStageAt(WAIT_PATIENCE_AFTER_MS), "patience");
    assert.equal(waitStageAt(60_000), "patience");
});

test("waitViewFor: nothing visible while quiet — a skeleton keeps its geometry but is not painted", () => {
    assert.deepEqual(waitViewFor("quiet", true), { skeleton: "hidden", spinner: false, text: false, patience: false });
    assert.deepEqual(waitViewFor("quiet", false), { skeleton: "none", spinner: false, text: false, patience: false });
});

test("waitViewFor: 300 ms–2 s is the layout-shaped skeleton if there is one, else only a spinner", () => {
    assert.deepEqual(waitViewFor("skeleton", true), { skeleton: "shown", spinner: false, text: false, patience: false });
    assert.deepEqual(waitViewFor("skeleton", false), { skeleton: "none", spinner: true, text: false, patience: false });
});

test("waitViewFor: past 2 s a status line appears; past 8 s one patience line joins it", () => {
    assert.deepEqual(waitViewFor("status", true), { skeleton: "shown", spinner: true, text: true, patience: false });
    assert.deepEqual(waitViewFor("patience", false), { skeleton: "none", spinner: true, text: true, patience: true });
});

import test from "node:test";
import assert from "node:assert/strict";
import { DOCK_DOWN_RUN, DOCK_TOP_ZONE, DOCK_UP_RUN, initialDockState, stepDock, type DockState } from "../../src/components/layout/dock-minimize";

/** Feeds scroll positions through the machine on a 3000px-tall page; returns the state after each. */
const feed = (ys: number[], opts: { maxY?: number; resting?: boolean; from?: DockState } = {}) => {
    let state = opts.from ?? initialDockState(ys[0]! - 1);
    const out: boolean[] = [];
    for (const y of ys) {
        state = stepDock(state, y, opts.maxY ?? 3000, opts.resting ?? false);
        out.push(state.minimized);
    }
    return { state, out };
};

test("full at the top of the page, whatever the direction", () => {
    assert.deepEqual(feed([0, 20, 40, DOCK_TOP_ZONE - 1]).out, [false, false, false, false]);
});

test("a run down past the top zone minimizes; a short run up restores", () => {
    const down = feed([200, 210, 220, 200 + DOCK_DOWN_RUN]);
    assert.deepEqual(down.out, [false, false, false, true]);
    const up = feed([200 + DOCK_DOWN_RUN - DOCK_UP_RUN], { from: down.state });
    assert.deepEqual(up.out, [false]);
});

test("a short nudge in either direction changes nothing", () => {
    const minimized = feed([200, 300]).state;
    assert.equal(minimized.minimized, true);
    assert.equal(feed([300 - (DOCK_UP_RUN - 1)], { from: minimized }).state.minimized, true);
    assert.equal(feed([100 + (DOCK_DOWN_RUN - 1)], { from: initialDockState(100) }).state.minimized, false);
});

test("a change of direction starts a new run (jitter while reading does not flip the dock)", () => {
    const { out } = feed([200, 215, 205, 220, 210, 225, 215]);
    assert.ok(out.every((m) => m === false), `flipped on jitter: ${out}`);
});

test("scrolling to the top restores the dock from any depth", () => {
    const deep = feed([500, 900]).state;
    assert.equal(deep.minimized, true);
    assert.equal(feed([DOCK_TOP_ZONE - 1], { from: deep }).state.minimized, false);
});

test("an accessory resting in the page (the end of it) always restores the dock", () => {
    const deep = feed([500, 900]).state;
    assert.equal(feed([960], { from: deep, resting: true }).state.minimized, false);
});

test("iOS rubber-banding past either end neither minimizes nor flips the dock", () => {
    assert.equal(feed([-40, -10]).state.minimized, false);
    const bottomBounce = feed([2990, 3000, 3030, 3060], { maxY: 3000, resting: false });
    assert.equal(bottomBounce.state.lastY, 3000);
});

test("the dock never reports a position outside the page", () => {
    const s = stepDock(initialDockState(100), 99999, 3000, false);
    assert.equal(s.lastY, 3000);
});

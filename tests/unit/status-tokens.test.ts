import { test } from "node:test";
import assert from "node:assert/strict";
import { ghostBadgeTone } from "../../src/lib/ui/status-tokens";

test("ghostBadgeTone: clear reads offer (green)", () => {
    assert.equal(ghostBadgeTone("clear"), "offer");
});

test("ghostBadgeTone: caution reads intv (amber)", () => {
    assert.equal(ghostBadgeTone("caution"), "intv");
});

test("ghostBadgeTone: likely_ghost reads closed (red) — distinct from caution", () => {
    assert.equal(ghostBadgeTone("likely_ghost"), "closed");
    assert.notEqual(ghostBadgeTone("likely_ghost"), ghostBadgeTone("caution"));
});

test("ghostBadgeTone: unscored and any other unrecognized value read null (no chip)", () => {
    assert.equal(ghostBadgeTone("unscored"), null);
    assert.equal(ghostBadgeTone("something-unrecognized"), null);
});

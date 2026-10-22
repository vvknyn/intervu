import assert from "node:assert/strict";
import { test } from "node:test";
import { pickPromoBand } from "../../src/lib/jobs/promo-band";

test("nothing eligible shows no band", () => {
    assert.equal(pickPromoBand({ "cold-orientation": false, extension: false }), null);
});

test("a single eligible band shows, whichever it is", () => {
    assert.equal(pickPromoBand({ "cold-orientation": true, extension: false }), "cold-orientation");
    assert.equal(pickPromoBand({ "cold-orientation": false, extension: true }), "extension");
});

test("two eligible bands never show together: the higher priority wins", () => {
    assert.equal(pickPromoBand({ "cold-orientation": true, extension: true }), "cold-orientation");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { PROMO_BAND_PRIORITY, pickPromoBand } from "../../src/lib/jobs/promo-band";

test("nothing eligible shows no band", () => {
    assert.equal(pickPromoBand({ extension: false }), null);
});

test("an eligible band shows", () => {
    assert.equal(pickPromoBand({ extension: true }), "extension");
});

test("the result is one band id or none, whatever is eligible", () => {
    const all = Object.fromEntries(PROMO_BAND_PRIORITY.map((id) => [id, true])) as Parameters<typeof pickPromoBand>[0];
    assert.equal(pickPromoBand(all), PROMO_BAND_PRIORITY[0]);
});

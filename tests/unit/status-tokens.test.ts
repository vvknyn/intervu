import { test } from "node:test";
import assert from "node:assert/strict";
import {
    ghostBadgeTone,
    LISTING_STATE_CHIP,
    LISTING_STATE_CHIP_LABEL,
    LISTING_STATE_TEXT,
    type ListingStateTone,
} from "../../src/lib/ui/status-tokens";

const LISTING_STATE_TONES: ListingStateTone[] = ["fresh", "relisted", "reported"];

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

test("listing-state maps have complete coverage — every tone has a chip, a chip-label, and a text class", () => {
    for (const tone of LISTING_STATE_TONES) {
        assert.ok(LISTING_STATE_CHIP[tone], `LISTING_STATE_CHIP missing "${tone}"`);
        assert.ok(LISTING_STATE_CHIP_LABEL[tone], `LISTING_STATE_CHIP_LABEL missing "${tone}"`);
        assert.ok(LISTING_STATE_TEXT[tone], `LISTING_STATE_TEXT missing "${tone}"`);
    }
});

test("listing-state tones are visually distinct from each other in every map", () => {
    for (const map of [LISTING_STATE_CHIP, LISTING_STATE_CHIP_LABEL, LISTING_STATE_TEXT]) {
        const values = LISTING_STATE_TONES.map((t) => map[t]);
        assert.equal(new Set(values).size, values.length, "expected no two tones to share a class string");
    }
});

test("reported chip is an outline (no filled bg) — must not read as the same weight as the likely_ghost verdict pill", () => {
    assert.doesNotMatch(LISTING_STATE_CHIP.reported, /bg-red-\d|bg-st-closed/, "reported chip must not use a filled/soft background");
});

// #421 (d254a782) moved these maps off raw sky/amber/red hues onto semantic tokens.
test("relisted uses the warn family, fresh uses brand, reported uses danger — across all three maps", () => {
    for (const map of [LISTING_STATE_CHIP, LISTING_STATE_CHIP_LABEL, LISTING_STATE_TEXT]) {
        assert.match(map.fresh, /text-brand/);
        assert.match(map.relisted, /text-warn/);
        assert.match(map.reported, /text-danger-text/);
    }
});

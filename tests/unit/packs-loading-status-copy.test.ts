import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    PACKS_LOADING_DECK,
    PACKS_LOADING_HUB,
    PACKS_LOADING_JD,
    PACKS_LOADING_ROTATE_MS,
    packsLoadingLine,
    packsLoadingPool,
} from "../../src/lib/jobs/for-you/loading-status-copy";

describe("packs loading status copy", () => {
    it("rotate interval sits in the 2.5–3.5s product window", () => {
        assert.ok(PACKS_LOADING_ROTATE_MS >= 2500 && PACKS_LOADING_ROTATE_MS <= 3500);
    });

    it("hub/deck/jd pools each have 6–12 calm lines", () => {
        for (const variant of ["hub", "deck", "jd"] as const) {
            const pool = packsLoadingPool(variant);
            assert.ok(pool.length >= 6 && pool.length <= 12, variant);
            for (const line of pool) {
                assert.ok(line.length > 8);
                assert.doesNotMatch(line, /Hang tight|our AI|ChatGPT|Brewing|Stalking/i);
                assert.match(line, /…$/);
            }
        }
    });

    it("packsLoadingLine advances sequentially and wraps", () => {
        assert.equal(packsLoadingLine("jd", 0), PACKS_LOADING_JD[0]);
        assert.equal(packsLoadingLine("jd", 1), PACKS_LOADING_JD[1]);
        assert.equal(packsLoadingLine("hub", PACKS_LOADING_HUB.length), PACKS_LOADING_HUB[0]);
        assert.equal(packsLoadingLine("deck", -1), PACKS_LOADING_DECK[PACKS_LOADING_DECK.length - 1]);
    });

    it("surfaces wire RotatingLoadingCopy for hub, deck skeleton, and JD hydrate", () => {
        const hub = readFileSync(join(__dirname, "../../src/components/jobs/CategoryHubGrid.tsx"), "utf8");
        const home = readFileSync(join(__dirname, "../../src/components/jobs/for-you/ForYouHome.tsx"), "utf8");
        const jd = readFileSync(
            join(__dirname, "../../src/components/jobs/for-you/DescriptionLoadingStatus.tsx"),
            "utf8",
        );
        assert.match(hub, /RotatingLoadingCopy/);
        assert.match(hub, /variant="hub"/);
        assert.match(home, /RotatingLoadingCopy/);
        assert.match(home, /withStatus/);
        assert.match(home, /variant="deck"/);
        assert.match(jd, /RotatingLoadingCopy/);
        assert.match(jd, /variant="jd"/);
    });
});
